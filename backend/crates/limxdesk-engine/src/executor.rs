// ============================================================
// 文件名称：executor.rs
// 功能描述：executor 级的回放实例
//
// 运行时状态过去挂在 sequence_id 上，同一个 sequence 指派到两个 executor 时
// 共用一个播放头。这里每个 executor 持有自己的实例：自己的 cue 指针、
// 自己的本地时钟、自己的淡变过程。sequence 退回成纯粹的内容容器。
//
// 每个实例维护本地时间而不是读挂钟：本地时间按 rate 缩放推进，所以改速率
// 会平滑地影响进行中的淡变，而不会让已经走过的部分跳变。
// ============================================================

use crate::compiled::{CompiledCue, CompiledSequence, CompiledValue};
use crate::interner::{Interner, ValueKey};
use limxdesk_dmx::{DmxChannelSource, DmxMergeMode, DmxOutputValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// executor 在 playback 文档里的唯一定位。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorKey {
    pub page_id: String,
    pub executor_id: String,
}

impl ExecutorKey {
    pub fn new(page_id: impl Into<String>, executor_id: impl Into<String>) -> Self {
        Self {
            page_id: page_id.into(),
            executor_id: executor_id.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlayState {
    #[default]
    Idle,
    Running,
    Paused,
    /// Off 之后的淡出过程，走完才回到 Idle。
    Releasing,
}

/// 一条多步链的游标。
#[derive(Clone, Debug, Default, PartialEq)]
struct ChaserCursor {
    step_index: usize,
    previous_step_index: Option<usize>,
    entered_at: f64,
}

/// 单个 executor 的回放实例。
#[derive(Clone, Debug)]
pub struct ExecutorRuntime {
    pub key: ExecutorKey,
    pub sequence_id: String,
    /// LTP 平局时的确定性排序依据，取 executor 编号。
    pub order: u32,
    pub state: PlayState,
    pub cue_index: Option<usize>,
    pub master: f64,
    pub rate: f64,
    /// Flash 期间强度顶到满，且不移动 cue 指针。
    pub flash: bool,
    /// 按下 Flash 那一刻该实例是否原本就停着。松开时要凭这个决定
    /// 是回到熄灭还是留在原本的播放状态 —— 按下之后再判断已经晚了，
    /// 那时状态已被 Flash 自己改成运行中。
    flash_latched_idle: bool,
    /// 本地时钟，按 rate 缩放推进。
    local_time_ms: f64,
    cue_entered_at: f64,
    /// 进入当前 cue 那一刻的实际输出，作为淡入起点。
    fade_from: HashMap<ValueKey, f64>,
    /// 释放淡出的起点与时长。
    release: Option<ReleaseState>,
    chasers: Vec<ChaserCursor>,
}

#[derive(Clone, Debug)]
struct ReleaseState {
    started_at: f64,
    fade_ms: f64,
    from: HashMap<ValueKey, f64>,
}

/// 一次 tick 之后该实例是否仍在运动。全部实例都静止时时钟就可以停下。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    Settled,
    Moving,
}

impl ExecutorRuntime {
    pub fn new(key: ExecutorKey, sequence_id: impl Into<String>, order: u32) -> Self {
        Self {
            key,
            sequence_id: sequence_id.into(),
            order,
            state: PlayState::Idle,
            cue_index: None,
            master: 1.0,
            rate: 1.0,
            flash: false,
            flash_latched_idle: false,
            local_time_ms: 0.0,
            cue_entered_at: 0.0,
            fade_from: HashMap::new(),
            release: None,
            chasers: Vec::new(),
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self.state,
            PlayState::Running | PlayState::Paused | PlayState::Releasing
        )
    }

    pub fn current_cue_id<'a>(&self, sequence: &'a CompiledSequence) -> Option<&'a str> {
        self.cue_index
            .and_then(|index| sequence.cues.get(index))
            .map(|cue| cue.id.as_str())
    }

    pub fn next_cue_id<'a>(&self, sequence: &'a CompiledSequence) -> Option<&'a str> {
        let index = self.cue_index?;
        let next = wrap_index(index + 1, sequence.cues.len())?;
        sequence.cues.get(next).map(|cue| cue.id.as_str())
    }

    /// 推进本地时钟并更新多步游标。
    pub fn tick(&mut self, sequence: &CompiledSequence, delta_ms: f64) -> Motion {
        if self.state == PlayState::Paused {
            return Motion::Settled;
        }
        if self.state == PlayState::Idle {
            return Motion::Settled;
        }

        let rate = if self.rate.is_finite() && self.rate > 0.0 {
            self.rate
        } else {
            1.0
        };
        self.local_time_ms += delta_ms.max(0.0) * rate;

        if let Some(release) = self.release.as_ref() {
            if self.local_time_ms - release.started_at >= release.fade_ms {
                self.reset_to_idle();
                return Motion::Settled;
            }
            return Motion::Moving;
        }

        let Some(cue) = self.current_cue(sequence) else {
            return Motion::Settled;
        };

        let mut moving = !self.fade_complete(cue);
        if self.advance_chasers(cue) {
            moving = true;
        }
        if moving {
            Motion::Moving
        } else {
            Motion::Settled
        }
    }

    /// Go —— 前进一个 cue，走到末尾回绕到开头。
    ///
    /// 回绕是有意的：chaser 与循环回放都建立在这个行为上。旧实现把索引
    /// 钳在最后一个 cue，序列走到底就再也动不了。
    pub fn go(&mut self, sequence: &CompiledSequence) {
        self.step_cue(sequence, 1);
    }

    /// Back —— 后退一个 cue，同样回绕。
    pub fn back(&mut self, sequence: &CompiledSequence) {
        self.step_cue(sequence, -1);
    }

    pub fn goto(&mut self, sequence: &CompiledSequence, cue_id: &str) -> bool {
        let Some(index) = sequence.cue_index(cue_id) else {
            return false;
        };
        self.enter_cue(sequence, index);
        true
    }

    /// Off —— release_on_off 为真时走淡出，否则立即熄灭。
    pub fn off(&mut self, sequence: &CompiledSequence, interner: &Interner) {
        if self.state == PlayState::Idle {
            return;
        }

        let fade_ms = self
            .current_cue(sequence)
            .map(|cue| cue.fade_out_ms)
            .unwrap_or(0.0);

        if !sequence.release_on_off || fade_ms <= 0.0 {
            self.reset_to_idle();
            return;
        }

        let mut from = HashMap::new();
        let mut values = Vec::new();
        self.collect_output(sequence, interner, &mut values);
        for value in &values {
            if let Some(key) = key_for(interner, value) {
                from.insert(key, value.numeric.unwrap_or(0.0));
            }
        }

        self.release = Some(ReleaseState {
            started_at: self.local_time_ms,
            fade_ms,
            from,
        });
        self.state = PlayState::Releasing;
    }

    /// Pause / Resume 切换。旧实现里 paused 只被写入过 false。
    pub fn toggle_pause(&mut self) {
        self.state = match self.state {
            PlayState::Running => PlayState::Paused,
            PlayState::Paused => PlayState::Running,
            other => other,
        };
    }

    pub fn pause(&mut self) {
        if self.state == PlayState::Running {
            self.state = PlayState::Paused;
        }
    }

    /// Toggle —— 在"起播"与"熄灭"之间切换，不是 Go 的别名。
    pub fn toggle(&mut self, sequence: &CompiledSequence, interner: &Interner) {
        if self.is_active() {
            self.off(sequence, interner);
        } else {
            self.go(sequence);
        }
    }

    /// Flash 按下 —— 临时把强度顶到满。
    ///
    /// 关键在于它不移动 cue 指针，也不改变播放状态：松开后回到按下前的样子。
    /// 序列没在跑时按 flash 会临时点亮第一个 cue。
    pub fn flash_on(&mut self, sequence: &CompiledSequence) {
        if !self.flash {
            self.flash_latched_idle = !self.is_active();
        }
        self.flash = true;
        if self.flash_latched_idle && !sequence.cues.is_empty() {
            self.enter_cue(sequence, 0);
        }
    }

    pub fn flash_off(&mut self) {
        if !self.flash {
            return;
        }
        self.flash = false;
        if self.flash_latched_idle {
            // 原本就停着，松开后立即回到熄灭，不走释放淡出。
            self.reset_to_idle();
        }
        self.flash_latched_idle = false;
    }

    pub fn set_master(&mut self, master: f64) {
        self.master = if master.is_finite() {
            master.clamp(0.0, 1.0)
        } else {
            1.0
        };
    }

    pub fn set_rate(&mut self, rate: f64) {
        self.rate = if rate.is_finite() {
            rate.clamp(0.01, 10.0)
        } else {
            1.0
        };
    }

    /// 产出该实例当前这一瞬的输出值。
    pub fn collect_output(
        &self,
        sequence: &CompiledSequence,
        interner: &Interner,
        out: &mut Vec<DmxOutputValue>,
    ) {
        if self.state == PlayState::Idle {
            return;
        }
        let Some(cue) = self.current_cue(sequence) else {
            return;
        };

        // 释放中：从淡出起点线性落到零，不再理会 cue 的稳态值。
        if let Some(release) = self.release.as_ref() {
            let progress = progress(self.local_time_ms - release.started_at, 0.0, release.fade_ms);
            for (key, from) in &release.from {
                push_value(
                    out,
                    interner,
                    *key,
                    from * (1.0 - progress),
                    DmxMergeMode::Htp,
                    sequence.priority,
                    self.order,
                );
            }
            return;
        }

        let elapsed = self.local_time_ms - self.cue_entered_at;
        let master = self.effective_master();

        for value in &cue.tracked {
            let target = value.numeric;
            let start = self.fade_from.get(&value.key).copied();
            let numeric = interpolate(cue, value, start, elapsed);
            push_value(
                out,
                interner,
                value.key,
                apply_master(numeric, value.merge, master),
                value.merge,
                sequence.priority,
                self.order,
            );
            let _ = target;
        }

        for (chaser, cursor) in cue.chasers.iter().zip(self.chasers.iter()) {
            let Some(step) = chaser.steps.get(cursor.step_index) else {
                continue;
            };
            let step_elapsed = self.local_time_ms - cursor.entered_at;
            let blend = progress(step_elapsed, 0.0, step.fade_ms);
            let previous = cursor
                .previous_step_index
                .and_then(|index| chaser.steps.get(index));

            for value in &step.values {
                let start = previous
                    .and_then(|previous| {
                        previous
                            .values
                            .iter()
                            .find(|candidate| candidate.key == value.key)
                    })
                    .map(|candidate| candidate.numeric);
                let numeric = match start {
                    Some(start) => lerp(start, value.numeric, blend),
                    None => value.numeric,
                };
                push_value(
                    out,
                    interner,
                    value.key,
                    apply_master(numeric, value.merge, master),
                    value.merge,
                    sequence.priority,
                    self.order,
                );
            }
        }
    }

    /// 供配方引擎读取的当前状态。
    pub fn recipe_state(&self) -> crate::recipe::RecipeExecutorState {
        crate::recipe::RecipeExecutorState {
            local_time_ms: self.local_time_ms,
            master: self.effective_master(),
            order: self.order,
        }
    }

    fn effective_master(&self) -> f64 {
        if self.flash {
            1.0
        } else {
            self.master
        }
    }

    fn current_cue<'a>(&self, sequence: &'a CompiledSequence) -> Option<&'a CompiledCue> {
        self.cue_index.and_then(|index| sequence.cues.get(index))
    }

    fn step_cue(&mut self, sequence: &CompiledSequence, delta: isize) {
        if sequence.cues.is_empty() {
            return;
        }
        let next = match self.cue_index {
            Some(index) => {
                let count = sequence.cues.len() as isize;
                (((index as isize + delta) % count + count) % count) as usize
            }
            None => {
                if delta >= 0 {
                    0
                } else {
                    sequence.cues.len() - 1
                }
            }
        };
        self.enter_cue(sequence, next);
    }

    /// 进入某个 cue：先把当前这一瞬的输出定格成淡入起点，再切换指针。
    fn enter_cue(&mut self, sequence: &CompiledSequence, index: usize) {
        let snapshot = self.snapshot_current_values(sequence);
        self.fade_from = snapshot;
        self.cue_index = Some(index);
        self.cue_entered_at = self.local_time_ms;
        self.state = PlayState::Running;
        self.release = None;
        self.reset_chasers(sequence, index);
    }

    /// 定格当前输出。淡变进行到一半时再次 Go，新的淡入要从"眼下看到的值"
    /// 起步，而不是从上一个 cue 的稳态值起步，否则光会往回跳一下。
    fn snapshot_current_values(&self, sequence: &CompiledSequence) -> HashMap<ValueKey, f64> {
        let mut snapshot = HashMap::new();
        let Some(cue) = self.current_cue(sequence) else {
            return snapshot;
        };
        let elapsed = self.local_time_ms - self.cue_entered_at;
        for value in &cue.tracked {
            let start = self.fade_from.get(&value.key).copied();
            snapshot.insert(value.key, interpolate(cue, value, start, elapsed));
        }
        snapshot
    }

    fn reset_chasers(&mut self, sequence: &CompiledSequence, cue_index: usize) {
        let count = sequence
            .cues
            .get(cue_index)
            .map(|cue| cue.chasers.len())
            .unwrap_or(0);
        self.chasers = (0..count)
            .map(|_| ChaserCursor {
                step_index: 0,
                previous_step_index: None,
                entered_at: self.local_time_ms,
            })
            .collect();
    }

    /// 推进所有多步链，返回是否有链在动。
    fn advance_chasers(&mut self, cue: &CompiledCue) -> bool {
        if self.chasers.len() != cue.chasers.len() {
            self.chasers = (0..cue.chasers.len())
                .map(|_| ChaserCursor {
                    step_index: 0,
                    previous_step_index: None,
                    entered_at: self.local_time_ms,
                })
                .collect();
        }

        let mut moving = false;
        for (chaser, cursor) in cue.chasers.iter().zip(self.chasers.iter_mut()) {
            if chaser.steps.len() < 2 {
                continue;
            }
            moving = true;
            let Some(step) = chaser.steps.get(cursor.step_index) else {
                continue;
            };
            if self.local_time_ms - cursor.entered_at >= step.duration_ms {
                cursor.previous_step_index = Some(cursor.step_index);
                cursor.step_index = (cursor.step_index + 1) % chaser.steps.len();
                cursor.entered_at = self.local_time_ms;
            }
        }
        moving
    }

    fn fade_complete(&self, cue: &CompiledCue) -> bool {
        let elapsed = self.local_time_ms - self.cue_entered_at;
        cue.tracked.iter().all(|value| {
            elapsed >= cue.delay_ms_for(value.key) + cue.fade_ms_for(value.key)
        })
    }

    fn reset_to_idle(&mut self) {
        self.state = PlayState::Idle;
        self.cue_index = None;
        self.fade_from.clear();
        self.release = None;
        self.chasers.clear();
    }
}

/// 按 per-attribute 的延迟与淡入时长求某一瞬的值。
fn interpolate(cue: &CompiledCue, value: &CompiledValue, start: Option<f64>, elapsed: f64) -> f64 {
    let Some(start) = start else {
        // 没有起点可依：强度从零升起，其余属性直接就位。位置类属性从零
        // 淡入会让灯甩过去。
        if value.merge == DmxMergeMode::Htp {
            let ratio = progress(
                elapsed,
                cue.delay_ms_for(value.key),
                cue.fade_ms_for(value.key),
            );
            return value.numeric * ratio;
        }
        return value.numeric;
    };

    let ratio = progress(
        elapsed,
        cue.delay_ms_for(value.key),
        cue.fade_ms_for(value.key),
    );
    lerp(start, value.numeric, ratio)
}

fn progress(elapsed: f64, delay_ms: f64, fade_ms: f64) -> f64 {
    if elapsed < delay_ms {
        return 0.0;
    }
    if fade_ms <= 0.0 {
        return 1.0;
    }
    ((elapsed - delay_ms) / fade_ms).clamp(0.0, 1.0)
}

fn lerp(from: f64, to: f64, ratio: f64) -> f64 {
    from + (to - from) * ratio
}

/// executor 推子控制强度。位置、颜色一类属性不该被推子缩放 ——
/// 把 Pan 乘以 0.5 只会让灯指向别处。
fn apply_master(numeric: f64, merge: DmxMergeMode, master: f64) -> f64 {
    match merge {
        DmxMergeMode::Htp => numeric * master,
        DmxMergeMode::Ltp => numeric,
    }
}

fn push_value(
    out: &mut Vec<DmxOutputValue>,
    interner: &Interner,
    key: ValueKey,
    numeric: f64,
    merge: DmxMergeMode,
    priority: u8,
    order: u32,
) {
    let fixture_id = interner.resolve(key.fixture);
    let attribute = interner.resolve(key.attribute);
    if fixture_id.is_empty() || attribute.is_empty() {
        return;
    }
    out.push(DmxOutputValue {
        fixture_id: fixture_id.to_string(),
        attribute: attribute.to_string(),
        numeric: Some(numeric),
        active: true,
        source: DmxChannelSource::Sequence,
        priority,
        merge,
        order,
    });
}

fn key_for(interner: &Interner, value: &DmxOutputValue) -> Option<ValueKey> {
    Some(ValueKey {
        fixture: interner.get(&value.fixture_id)?,
        attribute: interner.get(&value.attribute)?,
    })
}

fn wrap_index(index: usize, len: usize) -> Option<usize> {
    if len == 0 {
        None
    } else {
        Some(index % len)
    }
}
