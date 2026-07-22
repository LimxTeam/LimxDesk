// ============================================================
// 文件名称：keyframe.rs
// 功能描述：关键帧效果的接入与命令
//
// 适配层放在这里而不是任一 crate 内部，是为了保住依赖方向：
// limxdesk-keyframe 只管求值，不知道 DMX 与回放；limxdesk-engine 只定义
// 契约，不知道有哪些效果种类。两者在装配层相遇。
//
// 效果库是一份共享快照：文档写入时整体替换，渲染线程只读。
// ============================================================

use crate::{engine::EngineState, events, show::ShowRuntimeState};
use limxdesk_dmx::{merge_mode_for_feature_group, DmxChannelSource, DmxOutputValue};
use limxdesk_engine::{RecipeContext, RecipeEngine};
use limxdesk_keyframe::{
    evaluate, library::next_effect_number, library::normalize_document, normalize_effect,
    KeyframeEffect, KeyframeLibrary, KeyframeLibraryDocument, KeyframeTrack, TrackLayer,
};
use limxdesk_platform::current_timestamp_millis;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, State};

const KEYFRAME_SECTION_KEY: &str = "keyframe.v1";
const KEYFRAME_SECTION_VERSION: u16 = 1;

/// 该引擎在配方槽里的标识。
pub const KEYFRAME_ENGINE_KIND: &str = "keyframe";

/// 共享的效果库。渲染线程只读，命令线程整体替换。
#[derive(Default)]
pub struct KeyframeState {
    library: Arc<RwLock<KeyframeLibrary>>,
}

impl KeyframeState {
    pub(crate) fn handle(&self) -> Arc<RwLock<KeyframeLibrary>> {
        Arc::clone(&self.library)
    }

    pub(crate) fn replace(&self, document: &KeyframeLibraryDocument) -> Result<(), String> {
        let mut library = self
            .library
            .write()
            .map_err(|_| "keyframe library lock poisoned".to_string())?;
        *library = KeyframeLibrary::from_document(document);
        Ok(())
    }

}

/// 把关键帧效果接进渲染管线。
pub struct KeyframeRecipeEngine {
    library: Arc<RwLock<KeyframeLibrary>>,
}

impl KeyframeRecipeEngine {
    pub fn new(library: Arc<RwLock<KeyframeLibrary>>) -> Self {
        Self { library }
    }
}

impl RecipeEngine for KeyframeRecipeEngine {
    fn kind(&self) -> &str {
        KEYFRAME_ENGINE_KIND
    }

    fn contribute(&self, context: &RecipeContext<'_>, out: &mut Vec<DmxOutputValue>) {
        let Ok(library) = self.library.read() else {
            tracing::warn!("keyframe library lock poisoned; skipping effect");
            return;
        };
        let Some(effect) = library.get(&context.slot.effect_id) else {
            return;
        };

        // 效果时间就是所属 executor 的本地时钟，因此 executor 的 rate
        // 同样会拉伸效果 —— 一个推子既控回放速度也控效果速度。
        let frame = evaluate(effect, context.local_time_ms);
        push_effect_values(frame, context.master, out);
    }
}

/// 把一帧效果值并入输出。
///
/// 单独成函数是为了能直接测：相对轨道的叠加与推子的作用范围都在这里，
/// 而它们恰好是这层最容易出错的地方。
pub(crate) fn push_effect_values(
    frame: limxdesk_keyframe::EffectFrame,
    master: f64,
    out: &mut Vec<DmxOutputValue>,
) {
    for value in frame.values {
        let merge = merge_mode_for_feature_group(&value.feature_group);
        match value.layer {
            TrackLayer::Absolute => {
                let numeric = match merge {
                    // 强度类跟随 executor 推子，位置类不受推子影响 ——
                    // 与 cue 输出保持同一套规则。
                    limxdesk_dmx::DmxMergeMode::Htp => value.value * master,
                    limxdesk_dmx::DmxMergeMode::Ltp => value.value,
                };
                out.push(DmxOutputValue {
                    merge,
                    ..DmxOutputValue::simple(
                        value.fixture_id,
                        value.attribute,
                        Some(numeric),
                        true,
                        DmxChannelSource::Effect,
                    )
                });
            }
            TrackLayer::Relative => {
                // 相对轨道叠加在同一 executor 已产出的值之上。
                //
                // 这里能直接改 `out` 是因为回放引擎先收集 cue 输出、
                // 再调用配方：本轮里属于该 executor 的基准值已经在里面了。
                // 找不到基准就以 0 起算，让偏移单独成立而不是凭空消失。
                match out.iter_mut().find(|existing| {
                    existing.fixture_id == value.fixture_id
                        && existing.attribute == value.attribute
                }) {
                    Some(existing) => {
                        existing.numeric = Some(existing.numeric.unwrap_or(0.0) + value.value);
                        existing.source = DmxChannelSource::Effect;
                    }
                    None => out.push(DmxOutputValue {
                        merge,
                        ..DmxOutputValue::simple(
                            value.fixture_id,
                            value.attribute,
                            Some(value.value),
                            true,
                            DmxChannelSource::Effect,
                        )
                    }),
                }
            }
        }
    }
}

// ── 命令 ────────────────────────────────────────────────────

#[tauri::command]
pub fn keyframe_load_current_show(
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
) -> Result<KeyframeLibraryDocument, String> {
    let document = load_document(&show_state)?;
    keyframe_state.replace(&document)?;
    Ok(document)
}

#[tauri::command]
pub fn keyframe_create_effect(
    name: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    let number = next_effect_number(&document);
    let mut effect = KeyframeEffect::new(number, name.unwrap_or_default(), now_ms()?);
    // 新建的效果直接带一条 Dimmer 轨道：空效果无从下手，
    // 一条首尾帧的曲线才是可以立刻上手改的起点。
    effect.tracks.push(KeyframeTrack::new("Dimmer", "Dimmer"));

    document.selected_effect_id = Some(effect.id.clone());
    document.effects.push(effect);
    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

#[tauri::command]
pub fn keyframe_update_effect(
    effect: KeyframeEffect,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    let effect = normalize_effect(KeyframeEffect {
        updated_at_ms: now_ms()?,
        ..effect
    });

    match document
        .effects
        .iter_mut()
        .find(|existing| existing.id == effect.id)
    {
        Some(existing) => *existing = effect,
        None => return Err(format!("effect not found: {}", effect.id)),
    }
    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

#[tauri::command]
pub fn keyframe_delete_effect(
    effect_id: String,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    document.effects.retain(|effect| effect.id != effect_id);
    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

#[tauri::command]
pub fn keyframe_select_effect(
    effect_id: String,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    if !document.effects.iter().any(|effect| effect.id == effect_id) {
        return Err(format!("effect not found: {effect_id}"));
    }
    document.selected_effect_id = Some(effect_id);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

#[tauri::command]
pub fn keyframe_duplicate_effect(
    effect_id: String,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    let source = document
        .effects
        .iter()
        .find(|effect| effect.id == effect_id)
        .cloned()
        .ok_or_else(|| format!("effect not found: {effect_id}"))?;

    let number = next_effect_number(&document);
    let mut copy = KeyframeEffect::new(number, format!("{} copy", source.name), now_ms()?);
    copy.cycle_ms = source.cycle_ms;
    copy.playback = source.playback;
    copy.phase = source.phase;
    copy.fixtures = source.fixtures.clone();
    // 轨道要换新 id，否则两个效果的轨道会共用标识。
    copy.tracks = source
        .tracks
        .iter()
        .map(|track| KeyframeTrack {
            id: uuid_string(),
            ..track.clone()
        })
        .collect();

    document.selected_effect_id = Some(copy.id.clone());
    document.effects.push(copy);
    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

/// 把效果指派到某个 sequence 的配方槽上。
#[tauri::command]
pub fn keyframe_assign_to_sequence(
    sequence_id: String,
    effect_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<limxdesk_sequence::SequenceDocument, String> {
    let mut document = crate::sequence::load_sequence_document(&show_state)?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| format!("sequence not found: {sequence_id}"))?;

    // 同一个效果不重复挂载，重复指派视为幂等。
    if !sequence
        .recipe_slots
        .iter()
        .any(|slot| slot.effect_id == effect_id)
    {
        sequence
            .recipe_slots
            .push(limxdesk_sequence::SequenceRecipeSlot {
                id: uuid_string(),
                engine_kind: KEYFRAME_ENGINE_KIND.to_string(),
                effect_id,
                label: String::new(),
                enabled: true,
            });
    }
    document.version = document.version.saturating_add(1);
    crate::sequence::save_sequence_from_keyframe(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn keyframe_remove_from_sequence(
    sequence_id: String,
    slot_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<limxdesk_sequence::SequenceDocument, String> {
    let mut document = crate::sequence::load_sequence_document(&show_state)?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| format!("sequence not found: {sequence_id}"))?;
    sequence.recipe_slots.retain(|slot| slot.id != slot_id);
    document.version = document.version.saturating_add(1);
    crate::sequence::save_sequence_from_keyframe(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

// ── 内部 ────────────────────────────────────────────────────

pub(crate) fn load_document(
    state: &State<'_, ShowRuntimeState>,
) -> Result<KeyframeLibraryDocument, String> {
    let document = state
        .read_section::<KeyframeLibraryDocument>(KEYFRAME_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

fn save(
    document: &KeyframeLibraryDocument,
    show_state: &State<'_, ShowRuntimeState>,
    keyframe_state: &State<'_, KeyframeState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before editing effects.".to_string());
    };
    let document = normalize_document(document.clone());
    let saved = show_state.write_section(
        KEYFRAME_SECTION_KEY,
        KEYFRAME_SECTION_VERSION,
        &document,
    )?;
    keyframe_state.replace(&document)?;
    events::emit_keyframe_changed(app, &saved);

    // 效果改了就得重新出光，否则要等下一次操作才看得见。
    if let Err(error) = crate::output::request_output_send(app) {
        tracing::warn!("failed to request output after effect change: {error}");
    }
    let _ = engine_state;
    Ok(document)
}

fn now_ms() -> Result<u64, String> {
    current_timestamp_millis().map_err(|error| error.to_string())
}

fn uuid_string() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use limxdesk_keyframe::{EffectFrame, EffectValue};

    fn effect_value(attribute: &str, group: &str, layer: TrackLayer, value: f64) -> EffectValue {
        EffectValue {
            fixture_id: "fix-1".to_string(),
            attribute: attribute.to_string(),
            feature_group: group.to_string(),
            layer,
            value,
        }
    }

    fn frame(values: Vec<EffectValue>) -> EffectFrame {
        EffectFrame {
            values,
            finished: false,
        }
    }

    fn cue_value(attribute: &str, numeric: f64) -> DmxOutputValue {
        DmxOutputValue::simple(
            "fix-1",
            attribute,
            Some(numeric),
            true,
            DmxChannelSource::Sequence,
        )
    }

    fn find(values: &[DmxOutputValue], attribute: &str) -> Option<f64> {
        values
            .iter()
            .find(|value| value.attribute == attribute)
            .and_then(|value| value.numeric)
    }

    #[test]
    fn absolute_intensity_follows_the_executor_fader() {
        let mut out = Vec::new();
        push_effect_values(
            frame(vec![effect_value(
                "Dimmer",
                "Dimmer",
                TrackLayer::Absolute,
                80.0,
            )]),
            0.5,
            &mut out,
        );
        assert_eq!(find(&out, "Dimmer"), Some(40.0));
    }

    #[test]
    fn absolute_position_ignores_the_fader() {
        let mut out = Vec::new();
        push_effect_values(
            frame(vec![effect_value("Pan", "Position", TrackLayer::Absolute, 90.0)]),
            0.25,
            &mut out,
        );
        // 把 Pan 乘以推子只会让灯指向别处。
        assert_eq!(find(&out, "Pan"), Some(90.0));
    }

    #[test]
    fn relative_tracks_add_onto_the_cue_value() {
        let mut out = vec![cue_value("Pan", 100.0)];
        push_effect_values(
            frame(vec![effect_value("Pan", "Position", TrackLayer::Relative, -30.0)]),
            1.0,
            &mut out,
        );

        assert_eq!(out.len(), 1, "相对轨道应叠加而不是另起一条");
        assert_eq!(find(&out, "Pan"), Some(70.0));
        assert_eq!(out[0].source, DmxChannelSource::Effect);
    }

    #[test]
    fn a_relative_track_without_a_base_stands_on_its_own() {
        let mut out = Vec::new();
        push_effect_values(
            frame(vec![effect_value("Pan", "Position", TrackLayer::Relative, 25.0)]),
            1.0,
            &mut out,
        );
        // 没有基准就以 0 起算，而不是让偏移凭空消失。
        assert_eq!(find(&out, "Pan"), Some(25.0));
    }

    #[test]
    fn relative_tracks_only_touch_their_own_attribute() {
        let mut out = vec![cue_value("Pan", 100.0), cue_value("Tilt", 50.0)];
        push_effect_values(
            frame(vec![effect_value("Pan", "Position", TrackLayer::Relative, 10.0)]),
            1.0,
            &mut out,
        );

        assert_eq!(find(&out, "Pan"), Some(110.0));
        assert_eq!(find(&out, "Tilt"), Some(50.0));
    }

    #[test]
    fn effect_values_are_tagged_as_effect_source() {
        let mut out = Vec::new();
        push_effect_values(
            frame(vec![effect_value(
                "Dimmer",
                "Dimmer",
                TrackLayer::Absolute,
                100.0,
            )]),
            1.0,
            &mut out,
        );
        assert_eq!(out[0].source, DmxChannelSource::Effect);
        assert_eq!(out[0].merge, limxdesk_dmx::DmxMergeMode::Htp);
    }
}
