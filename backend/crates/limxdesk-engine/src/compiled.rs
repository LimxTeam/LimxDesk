// ============================================================
// 文件名称：compiled.rs
// 功能描述：把 SequenceDocument 编译成渲染就绪的运行时形态
//
// 渲染循环过去每帧都要 serde 反序列化整份 SequenceDocument 再 normalize 一遍，
// 并且 tracking 要从第一个 cue 逐个累积。两者都与帧率无关 —— 只有文档变了
// 结果才会变。这里在文档版本变化时编译一次：
//   1. 名称驻留成整数（见 interner）
//   2. tracking 结果预先累积进每个 cue
//   3. Absolute / Relative 归约成单一数值
//   4. Fade / Delay 层抽出来变成 per-attribute 的时间覆盖
//   5. 多步 part 编译成 chaser 链
// ============================================================

use crate::interner::{Interner, ValueKey};
use limxdesk_cue::{Cue, CueTiming, CueValue, CueValueLayer};
use limxdesk_dmx::{merge_mode_for_feature_group, DmxMergeMode};
use limxdesk_effect::AppliedEffect;
use limxdesk_sequence::{Sequence, SequenceDocument};
use std::collections::HashMap;

/// 一个已归约的输出值。
///
/// `numeric` 已经把 Absolute 基值与 Relative 偏移合并完毕 —— 运行时不再需要
/// 知道 layer 的存在。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CompiledValue {
    pub key: ValueKey,
    pub numeric: f64,
    pub merge: DmxMergeMode,
}

/// 单个属性的时间覆盖，来自 cue 里的 Fade / Delay 层。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AttributeTiming {
    pub fade_ms: Option<f64>,
    pub delay_ms: Option<f64>,
}

/// 一条多步链。part 里存在 steps 时，该 part 按步推进而不是一次全亮。
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledChaser {
    pub part_id: u16,
    pub steps: Vec<CompiledStep>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CompiledStep {
    pub values: Vec<CompiledValue>,
    /// 该步停留多久后推进到下一步。
    pub duration_ms: f64,
    /// 进入该步时的交叉淡入时长。
    pub fade_ms: f64,
}

/// 编译后的 cue。`tracked` 已包含 tracking 累积的结果。
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledCue {
    pub id: String,
    pub number: f64,
    pub name: String,
    pub fade_in_ms: f64,
    pub fade_out_ms: f64,
    pub delay_in_ms: f64,
    pub delay_out_ms: f64,
    /// cue 的稳态输出，已按 key 排序以便与其他 cue 做差分。
    pub tracked: Vec<CompiledValue>,
    pub timing_overrides: HashMap<ValueKey, AttributeTiming>,
    pub chasers: Vec<CompiledChaser>,
    /// 该 cue 上的效果实例。Go 到这个 cue 就跑，走开就停。
    pub effects: Vec<AppliedEffect>,
}

impl CompiledCue {
    /// 该属性的实际淡入时长，per-attribute 覆盖优先于 cue 级时长。
    pub fn fade_ms_for(&self, key: ValueKey) -> f64 {
        self.timing_overrides
            .get(&key)
            .and_then(|timing| timing.fade_ms)
            .unwrap_or(self.fade_in_ms)
    }

    /// 该属性的实际延迟，同样 per-attribute 覆盖优先。
    pub fn delay_ms_for(&self, key: ValueKey) -> f64 {
        self.timing_overrides
            .get(&key)
            .and_then(|timing| timing.delay_ms)
            .unwrap_or(self.delay_in_ms)
    }

    /// 是否存在需要持续推进的多步链。
    pub fn has_chasers(&self) -> bool {
        self.chasers.iter().any(|chaser| chaser.steps.len() > 1)
    }

    /// 是否挂着效果。效果在跑就不能让时钟停下。
    pub fn has_effects(&self) -> bool {
        self.effects.iter().any(AppliedEffect::has_output)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct CompiledSequence {
    pub id: String,
    pub number: u32,
    pub name: String,
    pub priority: u8,
    pub tracking: bool,
    pub release_on_off: bool,
    pub cues: Vec<CompiledCue>,
}

impl CompiledSequence {
    pub fn cue_index(&self, cue_id: &str) -> Option<usize> {
        self.cues.iter().position(|cue| cue.id == cue_id)
    }
}

/// 整个 show 的编译产物，按文档版本缓存。
#[derive(Clone, Debug, Default)]
pub struct CompiledShow {
    pub version: u64,
    pub interner: Interner,
    sequences: Vec<CompiledSequence>,
    by_id: HashMap<String, usize>,
}

impl CompiledShow {
    pub fn sequence(&self, sequence_id: &str) -> Option<&CompiledSequence> {
        self.by_id
            .get(sequence_id)
            .and_then(|index| self.sequences.get(*index))
    }

    pub fn sequences(&self) -> &[CompiledSequence] {
        &self.sequences
    }
}

/// 编译整份文档。调用方负责按 `document.version` 缓存结果。
pub fn compile_document(document: &SequenceDocument) -> CompiledShow {
    let mut interner = Interner::new();
    let sequences = document
        .sequences
        .iter()
        .map(|sequence| compile_sequence(sequence, &mut interner))
        .collect::<Vec<_>>();
    let by_id = sequences
        .iter()
        .enumerate()
        .map(|(index, sequence)| (sequence.id.clone(), index))
        .collect();

    CompiledShow {
        version: document.version,
        interner,
        sequences,
        by_id,
    }
}

fn compile_sequence(sequence: &Sequence, interner: &mut Interner) -> CompiledSequence {
    // tracking 状态：从第一个 cue 起逐个累积，每个 cue 落一份快照。
    // 这正是过去每帧重算的那段工作，现在只在文档变化时做一次。
    let mut carried: HashMap<ValueKey, CompiledValue> = HashMap::new();
    let mut cues = Vec::with_capacity(sequence.cues.len());

    for cue in &sequence.cues {
        if !sequence.tracking {
            carried.clear();
        }
        cues.push(compile_cue(cue, interner, &mut carried));
    }

    CompiledSequence {
        id: sequence.id.clone(),
        number: sequence.number,
        name: sequence.name.clone(),
        priority: sequence.priority,
        tracking: sequence.tracking,
        release_on_off: sequence.release_on_off,
        cues,
    }
}

fn compile_cue(
    cue: &Cue,
    interner: &mut Interner,
    carried: &mut HashMap<ValueKey, CompiledValue>,
) -> CompiledCue {
    let mut timing_overrides: HashMap<ValueKey, AttributeTiming> = HashMap::new();
    let mut chasers = Vec::new();
    let mut effects = Vec::new();

    // 停用的 cue 不贡献任何值，但仍要占住序号位置，否则 Go 的索引会错位。
    if cue.enabled {
        effects = cue.output_effects();
        for part in &cue.parts {
            for value in part.values.iter().filter(|value| value.active) {
                apply_value(value, interner, carried, &mut timing_overrides);
            }

            if part.steps.len() > 1 {
                chasers.push(compile_chaser(part, interner, &cue.timing));
            } else if let Some(step) = part.steps.first() {
                // 单步与普通 part 值等价，直接并入稳态。
                for value in step.values.iter().filter(|value| value.active) {
                    apply_value(value, interner, carried, &mut timing_overrides);
                }
            }
        }
    }

    let mut tracked = carried.values().copied().collect::<Vec<_>>();
    tracked.sort_by_key(|value| value.key);

    CompiledCue {
        id: cue.id.clone(),
        number: cue.number,
        name: cue.name.clone(),
        fade_in_ms: seconds_to_ms(cue.timing.fade_in),
        fade_out_ms: seconds_to_ms(cue.timing.fade_out),
        delay_in_ms: seconds_to_ms(cue.timing.delay_in),
        delay_out_ms: seconds_to_ms(cue.timing.delay_out),
        tracked,
        timing_overrides,
        chasers,
        effects,
    }
}

fn compile_chaser(
    part: &limxdesk_cue::CuePart,
    interner: &mut Interner,
    cue_timing: &CueTiming,
) -> CompiledChaser {
    // 每步的停留时长按 step → part → cue 的顺序回退。全都没给时才用兜底值，
    // 否则一条 duration 为 0 的链会在一帧里转完所有步。
    let part_duration = part.timing.duration.or(cue_timing.duration);
    let steps = part
        .steps
        .iter()
        .map(|step| {
            let duration = step
                .timing
                .duration
                .or(part_duration)
                .map(seconds_to_ms)
                .filter(|duration| *duration > 0.0)
                .unwrap_or(DEFAULT_STEP_DURATION_MS);
            CompiledStep {
                values: step
                    .values
                    .iter()
                    .filter(|value| value.active)
                    .filter_map(|value| compile_standalone_value(value, interner))
                    .collect(),
                duration_ms: duration,
                fade_ms: seconds_to_ms(step.timing.fade_in),
            }
        })
        .collect();

    CompiledChaser {
        part_id: part.id,
        steps,
    }
}

/// 把一个 cue 值并入 tracking 状态。
///
/// Absolute 覆盖基值，Relative 在基值上累加 —— 这两层都参与输出。
/// Fade / Delay 不是输出值，它们是该属性的时间覆盖，抽出来单独存放。
fn apply_value(
    value: &CueValue,
    interner: &mut Interner,
    carried: &mut HashMap<ValueKey, CompiledValue>,
    timing_overrides: &mut HashMap<ValueKey, AttributeTiming>,
) {
    let key = ValueKey {
        fixture: interner.intern(&value.fixture_id),
        attribute: interner.intern(&value.attribute),
    };

    match value.layer {
        CueValueLayer::Absolute => {
            let Some(numeric) = finite(value.numeric) else {
                return;
            };
            carried.insert(
                key,
                CompiledValue {
                    key,
                    numeric,
                    merge: merge_mode_for_feature_group(&value.feature_group),
                },
            );
        }
        CueValueLayer::Relative => {
            let Some(offset) = finite(value.numeric) else {
                return;
            };
            carried
                .entry(key)
                .and_modify(|existing| existing.numeric += offset)
                .or_insert(CompiledValue {
                    key,
                    numeric: offset,
                    merge: merge_mode_for_feature_group(&value.feature_group),
                });
        }
        CueValueLayer::Fade => {
            timing_overrides.entry(key).or_default().fade_ms =
                finite(value.numeric).map(seconds_to_ms);
        }
        CueValueLayer::Delay => {
            timing_overrides.entry(key).or_default().delay_ms =
                finite(value.numeric).map(seconds_to_ms);
        }
    }
}

/// 编译一个不参与 tracking 的值（chaser 的步值）。
fn compile_standalone_value(value: &CueValue, interner: &mut Interner) -> Option<CompiledValue> {
    if !matches!(value.layer, CueValueLayer::Absolute | CueValueLayer::Relative) {
        return None;
    }
    let numeric = finite(value.numeric)?;
    Some(CompiledValue {
        key: ValueKey {
            fixture: interner.intern(&value.fixture_id),
            attribute: interner.intern(&value.attribute),
        },
        numeric,
        merge: merge_mode_for_feature_group(&value.feature_group),
    })
}

/// 步时长的兜底值，仅在 cue、part、step 三级都没给出时使用。
const DEFAULT_STEP_DURATION_MS: f64 = 1000.0;

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite())
}

fn seconds_to_ms(seconds: f64) -> f64 {
    if seconds.is_finite() {
        (seconds * 1000.0).max(0.0)
    } else {
        0.0
    }
}
