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

use crate::{
    engine::EngineState, events, fixture_selection::FixtureSelectionState,
    programmer::ProgrammerState, show::ShowRuntimeState,
};
use limxdesk_dmx::{merge_mode_for_feature_group, DmxChannelSource, DmxOutputValue};
use limxdesk_effect::AppliedEffect;
use limxdesk_engine::{RecipeContext, RecipeEngine};
use limxdesk_keyframe::{
    evaluate, library::next_effect_number, library::normalize_document, normalize_effect,
    FrameValue, KeyframeEffect, KeyframeLibrary, KeyframeLibraryDocument, TrackLayer,
};
use limxdesk_platform::current_timestamp_millis;
use serde::Serialize;
use std::collections::BTreeMap;
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
    /// programmer 里效果的计时起点。
    ///
    /// programmer 没有 executor 那样的本地时钟，但效果需要一个 t。第一次
    /// 往 programmer 加效果时记下这一刻，之后所有 programmer 效果共用它 ——
    /// 这样同时加的几个效果相位一致，Once / 定次也能真正跑完而不是一上来
    /// 就是完成态。
    programmer_epoch: Arc<RwLock<Option<u64>>>,
}

impl KeyframeState {
    pub(crate) fn handle(&self) -> Arc<RwLock<KeyframeLibrary>> {
        Arc::clone(&self.library)
    }

    pub(crate) fn epoch_handle(&self) -> Arc<RwLock<Option<u64>>> {
        Arc::clone(&self.programmer_epoch)
    }

    /// 记下计时起点，已经有就沿用。
    pub(crate) fn mark_epoch(&self, now_ms: u64) -> Result<(), String> {
        let mut epoch = self
            .programmer_epoch
            .write()
            .map_err(|_| "keyframe epoch lock poisoned".to_string())?;
        epoch.get_or_insert(now_ms);
        Ok(())
    }

    /// programmer 里没有效果了就把起点清掉，下次重新计时。
    pub(crate) fn reset_epoch(&self) -> Result<(), String> {
        let mut epoch = self
            .programmer_epoch
            .write()
            .map_err(|_| "keyframe epoch lock poisoned".to_string())?;
        *epoch = None;
        Ok(())
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
        let Some(template) = library.get(&context.applied.effect_id) else {
            return;
        };

        // 效果时间就是所属 executor 的本地时钟，因此 executor 的 rate
        // 同样会拉伸效果 —— 一个推子既控回放速度也控效果速度。
        let frame = evaluate(
            template,
            context.local_time_ms,
            &context.applied.fixture_ids,
            context.applied.overrides,
        );
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

/// 求 programmer 效果层这一瞬的输出。
///
/// programmer 的值优先级最高，效果也一样 —— 你正在手上调的东西应该盖过
/// 回放。渲染路径每帧调它，因此只做哈希查找与曲线求值，不碰文档。
pub(crate) fn programmer_effect_values(
    programmer: &limxdesk_programmer::Programmer,
    library: &KeyframeLibrary,
    epoch_ms: Option<u64>,
    now_ms: u64,
    out: &mut Vec<DmxOutputValue>,
) {
    let applied_effects = programmer.effects();
    if applied_effects.is_empty() {
        return;
    }
    let elapsed = epoch_ms
        .map(|epoch| now_ms.saturating_sub(epoch) as f64)
        .unwrap_or(0.0);

    for applied in applied_effects.iter().filter(|effect| effect.has_output()) {
        if applied.engine_kind != KEYFRAME_ENGINE_KIND {
            continue;
        }
        let Some(template) = library.get(&applied.effect_id) else {
            continue;
        };
        let frame = evaluate(template, elapsed, &applied.fixture_ids, applied.overrides);
        // programmer 不经过 executor 推子，满幅输出。
        push_effect_values(frame, 1.0, out);
    }

    // programmer 的东西盖过回放。
    for value in out.iter_mut() {
        if value.source == DmxChannelSource::Effect {
            value.source = DmxChannelSource::Programmer;
        }
    }
}

/// programmer 里是否有还在动的效果。用来决定时钟能不能停。
pub(crate) fn programmer_effects_moving(
    programmer: &limxdesk_programmer::Programmer,
    library: &KeyframeLibrary,
) -> bool {
    programmer
        .effects()
        .iter()
        .filter(|effect| effect.has_output())
        .any(|applied| {
            library
                .get(&applied.effect_id)
                .is_some_and(limxdesk_keyframe::KeyframeEffect::is_endless)
        })
}

// ── 属性查询 ────────────────────────────────────────────────

/// 一个可用于建轨道的属性，直接来自灯具类型的 GDTF 定义。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectAttributeOption {
    pub name: String,
    pub feature_group: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub default_value: Option<f64>,
    pub value_kind: String,
    /// 给定灯具中有多少盏具备该属性。不是全体都有时前端要能看出来。
    pub fixture_count: usize,
    /// 给定灯具总数。
    pub total_fixtures: usize,
}

/// 列出给定灯具实际具备的属性。
///
/// 属性来自每盏灯所用模式的 GDTF 定义 —— 不同型号能做的事不一样，
/// 一份写死的清单在真实 rig 上必然是错的。
#[tauri::command]
pub fn keyframe_available_attributes(
    fixture_ids: Vec<String>,
    show_state: State<'_, ShowRuntimeState>,
) -> Result<Vec<EffectAttributeOption>, String> {
    collect_attribute_options(&fixture_ids, &show_state)
}

fn collect_attribute_options(
    fixture_ids: &[String],
    show_state: &State<'_, ShowRuntimeState>,
) -> Result<Vec<EffectAttributeOption>, String> {
    if fixture_ids.is_empty() {
        return Ok(Vec::new());
    }

    let patch = crate::patch::load_patch_document(show_state)?;
    let fixture_types = crate::fixture_types::load_current_show_entries(show_state)?;

    // 子灯具（fix::sub:x）的属性取自父灯具。
    let mut wanted = fixture_ids
        .iter()
        .map(|id| parent_fixture_id(id).to_string())
        .collect::<Vec<_>>();
    wanted.sort();
    wanted.dedup();

    let mut options: BTreeMap<String, EffectAttributeOption> = BTreeMap::new();
    let mut resolved = 0_usize;

    for fixture_id in &wanted {
        let Some(fixture) = patch.fixtures.iter().find(|item| &item.id == fixture_id) else {
            continue;
        };
        let Some(mode) = resolve_mode(fixture, &fixture_types) else {
            continue;
        };
        resolved += 1;

        for attribute in &mode.attribute_details {
            let entry = options
                .entry(attribute.name.clone())
                .or_insert_with(|| EffectAttributeOption {
                    name: attribute.name.clone(),
                    feature_group: attribute.feature_group.clone(),
                    min_value: attribute.min_value,
                    max_value: attribute.max_value,
                    default_value: attribute.default_value,
                    value_kind: attribute.value_kind.clone(),
                    fixture_count: 0,
                    total_fixtures: 0,
                });
            entry.fixture_count += 1;
            // 型号之间量程可能不同，取并集，曲线才不会被某一款的范围卡住。
            entry.min_value = min_option(entry.min_value, attribute.min_value);
            entry.max_value = max_option(entry.max_value, attribute.max_value);
        }
    }

    let mut options = options.into_values().collect::<Vec<_>>();
    for option in &mut options {
        option.total_fixtures = resolved;
    }
    // 先按 feature group 的惯用次序，再按名称。
    options.sort_by(|left, right| {
        feature_group_rank(&left.feature_group)
            .cmp(&feature_group_rank(&right.feature_group))
            .then(left.name.cmp(&right.name))
    });
    Ok(options)
}

fn resolve_mode<'a>(
    fixture: &limxdesk_patch::PatchFixture,
    fixture_types: &'a [limxdesk_fixture_types::FixtureTypeEntry],
) -> Option<&'a limxdesk_fixture_types::FixtureModeEntry> {
    let fixture_type = fixture_types.iter().find(|item| {
        item.path == fixture.fixture_type_path
            || item.id == fixture.fixture_type_id
            || format!("{} {}", item.manufacturer, item.name).trim() == fixture.fixture_type_name
    })?;

    fixture_type
        .modes
        .iter()
        .find(|mode| mode.id == fixture.mode_id)
        .or_else(|| {
            fixture_type
                .modes
                .iter()
                .find(|mode| mode.name == fixture.mode_name)
        })
        .or_else(|| {
            fixture_type
                .modes
                .iter()
                .find(|mode| mode.channels == fixture.channels)
        })
        .or_else(|| fixture_type.modes.first())
}

fn parent_fixture_id(id: &str) -> &str {
    id.split("::sub:").next().unwrap_or(id)
}

fn min_option(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (value, None) | (None, value) => value,
    }
}

fn max_option(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (value, None) | (None, value) => value,
    }
}

/// 控台惯用的 feature group 次序。
fn feature_group_rank(group: &str) -> u8 {
    match group.to_ascii_lowercase().as_str() {
        "dimmer" => 0,
        "position" => 1,
        "color" => 2,
        "gobo" => 3,
        "beam" => 4,
        "focus" => 5,
        "strobe" => 6,
        "control" => 8,
        _ => 7,
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
    selection_state: State<'_, FixtureSelectionState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    let number = next_effect_number(&document);
    let effect = KeyframeEffect::new(number, name.unwrap_or_default(), now_ms()?);

    // 模板建出来是空的。轨道在"应用"那一刻按 programmer 里已激活的属性
    // 生成 —— 你调过什么，效果就驱动什么。这里猜属性只会猜错。
    let _ = &selection_state;

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
    copy.attributes = source.attributes.clone();
    // 帧要换新 id，否则两个效果的帧会共用标识。
    copy.frames = source
        .frames
        .iter()
        .map(|frame| limxdesk_keyframe::Keyframe {
            id: uuid_string(),
            ..frame.clone()
        })
        .collect();

    document.selected_effect_id = Some(copy.id.clone());
    document.effects.push(copy);
    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

/// 把效果应用到当前选择，进入 programmer。
///
/// 这是效果的入口动作，和给选中的灯设一个属性值属于同一类操作：效果落在
/// programmer 的效果层上，能立刻看到、能改参数、能被 Clear 清掉。
/// 之后按 Store 选一个插槽，它随 programmer 一起进 cue —— 存效果不需要
/// 单独的命令，走的是已有的那条保存链路。
#[tauri::command]
pub fn keyframe_apply_to_selection(
    effect_id: String,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    keyframe_state: State<'_, KeyframeState>,
    app: AppHandle,
) -> Result<limxdesk_programmer::Programmer, String> {
    let library = load_document(&show_state)?;
    if !library.effects.iter().any(|effect| effect.id == effect_id) {
        return Err(format!("effect not found: {effect_id}"));
    }

    let selection = selection_state.current()?;
    if selection.fixture_ids.is_empty() {
        return Err("Select fixtures before applying an effect.".to_string());
    }

    let programmer = programmer_state.current()?;

    // 顺序即相位铺开的次序，沿用选择本身的顺序。
    let applied = AppliedEffect::new(
        KEYFRAME_ENGINE_KIND,
        effect_id,
        selection.fixture_ids.clone(),
    );
    keyframe_state.mark_epoch(now_ms()?)?;
    let programmer = programmer.apply_effect(applied);
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(app_handle(&app), &programmer);
    request_output(&app);
    Ok(programmer)
}

/// 打一帧：把编程器里此刻的值记在指定角度上。
///
/// 这是关键帧的核心动作。把灯调成想要的样子 —— 颜色、位置、强度，
/// 无论几个属性 —— 然后在某个角度打一帧，那一刻的全部激活属性被一起
/// 记下。再调一次、再打一帧，效果就在两帧之间跑。
///
/// 一帧横跨所有属性而不是每个属性各打各的：红色是 R/G/B 三个值同时
/// 成立的一件事，拆开记就不再是一个颜色了。
#[tauri::command]
pub fn keyframe_capture_frame(
    effect_id: String,
    angle: f64,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let selection = selection_state.current()?;
    let active = programmer_state
        .current()?
        .active_attributes(&selection);
    if active.is_empty() {
        return Err(
            "Nothing to capture — set the fixtures to the look you want first.".to_string(),
        );
    }

    let mut document = load_document(&show_state)?;
    let effect = document
        .effects
        .iter_mut()
        .find(|effect| effect.id == effect_id)
        .ok_or_else(|| format!("effect not found: {effect_id}"))?;

    let values = active
        .iter()
        .filter_map(|entry| {
            entry.value.filter(|value| value.is_finite()).map(|value| {
                FrameValue {
                    attribute: entry.attribute.clone(),
                    value,
                }
            })
        })
        .collect::<Vec<_>>();
    if values.is_empty() {
        return Err("The active attributes have no numeric value to capture.".to_string());
    }

    for entry in &active {
        effect.ensure_attribute(&entry.attribute, &entry.feature_group);
    }
    effect.capture_frame(angle, values);
    effect.updated_at_ms = now_ms()?;

    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

/// 删掉一帧。
#[tauri::command]
pub fn keyframe_remove_frame(
    effect_id: String,
    frame_id: String,
    show_state: State<'_, ShowRuntimeState>,
    keyframe_state: State<'_, KeyframeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<KeyframeLibraryDocument, String> {
    let mut document = load_document(&show_state)?;
    let effect = document
        .effects
        .iter_mut()
        .find(|effect| effect.id == effect_id)
        .ok_or_else(|| format!("effect not found: {effect_id}"))?;
    effect.remove_frame(&frame_id);
    effect.updated_at_ms = now_ms()?;

    document.version = document.version.saturating_add(1);
    save(&document, &show_state, &keyframe_state, &engine_state, &app)
}

/// 改 programmer 里某个效果实例的参数（速度 / 相位 / 幅度）。
#[tauri::command]
pub fn keyframe_update_applied(
    applied: AppliedEffect,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<limxdesk_programmer::Programmer, String> {
    let programmer = programmer_state.current()?.update_effect(applied);
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(app_handle(&app), &programmer);
    request_output(&app);
    Ok(programmer)
}

/// 从 programmer 里移除一个效果实例。
#[tauri::command]
pub fn keyframe_remove_applied(
    applied_id: String,
    programmer_state: State<'_, ProgrammerState>,
    keyframe_state: State<'_, KeyframeState>,
    app: AppHandle,
) -> Result<limxdesk_programmer::Programmer, String> {
    let programmer = programmer_state.current()?.remove_effect(&applied_id);
    let programmer = programmer_state.set_current(programmer)?;
    if programmer.effects().is_empty() {
        keyframe_state.reset_epoch()?;
    }
    events::emit_programmer_changed(app_handle(&app), &programmer);
    request_output(&app);
    Ok(programmer)
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

fn app_handle(app: &AppHandle) -> &AppHandle {
    app
}

fn request_output(app: &AppHandle) {
    if let Err(error) = crate::output::request_output_send(app) {
        tracing::warn!("failed to request output after effect change: {error}");
    }
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
