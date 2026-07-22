// ============================================================
// 文件名称：lib.rs
// 功能描述：LimxDesk 回放引擎
//
// 这一层承载所有随时间变化的状态；cue / sequence / playback 三个 crate
// 保持为纯粹的文档模型。分工是：
//   · compiled  —— 文档编译成渲染就绪的形态，按版本缓存
//   · executor  —— 每个 executor 一个独立回放实例
//   · recipe    —— 配方引擎的接入契约
//   · 本文件    —— 引擎门面：时钟、实例表、输出汇总
//
// 时钟只在有东西在动的时候跑。淡变走完、多步链停下之后 tick 返回 Settled，
// 调用方就可以让线程歇下来，直到下一次操作把它唤醒。
// ============================================================

pub mod compiled;
pub mod executor;
pub mod interner;
pub mod recipe;

pub use compiled::{
    compile_document, AttributeTiming, CompiledChaser, CompiledCue, CompiledSequence,
    CompiledShow, CompiledStep, CompiledValue,
};
pub use executor::{ExecutorKey, ExecutorRuntime, Motion, PlayState};
pub use interner::{Interner, SymbolId, ValueKey};
pub use recipe::{RecipeContext, RecipeEngine, RecipeExecutorState, RecipeRegistry};

use limxdesk_dmx::DmxOutputValue;
use limxdesk_playback::{PlaybackAction, PlaybackDocument};
use limxdesk_sequence::SequenceDocument;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 引擎对外暴露的单个 executor 状态，供前端显示。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorStateSnapshot {
    pub page_id: String,
    pub executor_id: String,
    pub sequence_id: String,
    pub state: PlayState,
    pub current_cue_id: Option<String>,
    pub next_cue_id: Option<String>,
    pub master: f64,
    pub rate: f64,
    pub flash: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    pub executors: Vec<ExecutorStateSnapshot>,
}

/// 回放引擎。
#[derive(Default)]
pub struct PlaybackEngine {
    compiled: CompiledShow,
    /// 用 BTreeMap 而不是 HashMap：输出顺序必须可复现，
    /// 否则同优先级下"谁覆盖谁"会随哈希种子变化。
    executors: BTreeMap<ExecutorKey, ExecutorRuntime>,
    recipes: RecipeRegistry,
    last_tick_ms: Option<u64>,
}

impl PlaybackEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn recipes_mut(&mut self) -> &mut RecipeRegistry {
        &mut self.recipes
    }

    pub fn compiled(&self) -> &CompiledShow {
        &self.compiled
    }

    /// 让编译产物跟上文档。版本没变就什么都不做 —— 这正是把每帧的
    /// 反序列化与 tracking 累积省掉的地方。
    pub fn sync_document(&mut self, document: &SequenceDocument) {
        if self.compiled.version == document.version && !self.compiled.sequences().is_empty() {
            return;
        }
        self.compiled = compile_document(document);
        self.prune_missing_sequences();
    }

    /// 文档被整体替换（换 show、导入）时强制重编译。
    pub fn reload_document(&mut self, document: &SequenceDocument) {
        self.compiled = compile_document(document);
        self.prune_missing_sequences();
    }

    pub fn clear(&mut self) {
        self.executors.clear();
        self.last_tick_ms = None;
    }

    /// 按 playback 文档同步实例表：清掉已解除指派的 executor，
    /// 补上新指派的。
    pub fn sync_assignments(&mut self, playback: &PlaybackDocument) {
        let mut live = Vec::new();
        for page in &playback.pages {
            for executor in &page.executors {
                let Some(assignment) = executor.assignment.as_ref() else {
                    continue;
                };
                let key = ExecutorKey::new(page.id.clone(), executor.id.clone());
                live.push(key.clone());

                match self.executors.get_mut(&key) {
                    Some(runtime) => {
                        // 指派换了对象，旧的播放头就没有意义了。
                        if runtime.sequence_id != assignment.object_id {
                            *runtime = ExecutorRuntime::new(
                                key,
                                assignment.object_id.clone(),
                                u32::from(executor.number),
                            );
                        }
                    }
                    None => {
                        let mut runtime = ExecutorRuntime::new(
                            key.clone(),
                            assignment.object_id.clone(),
                            u32::from(executor.number),
                        );
                        // 文档里的推子值是上电默认值。
                        runtime.set_master(executor.fader.master);
                        runtime.set_rate(executor.fader.rate);
                        self.executors.insert(key, runtime);
                    }
                }
            }
        }

        self.executors.retain(|key, _| live.contains(key));
    }

    /// 推进时钟。返回是否还有东西在动。
    pub fn tick(&mut self, now_ms: u64) -> Motion {
        let delta_ms = match self.last_tick_ms {
            Some(last) => now_ms.saturating_sub(last) as f64,
            None => 0.0,
        };
        self.last_tick_ms = Some(now_ms);

        let mut motion = Motion::Settled;
        for runtime in self.executors.values_mut() {
            let Some(sequence) = self.compiled.sequence(&runtime.sequence_id) else {
                continue;
            };
            if runtime.tick(sequence, delta_ms) == Motion::Moving {
                motion = Motion::Moving;
            }
        }
        motion
    }

    /// 汇总所有实例这一瞬的输出。
    pub fn collect_output(&self) -> Vec<DmxOutputValue> {
        let mut out = Vec::new();
        for runtime in self.executors.values() {
            let Some(sequence) = self.compiled.sequence(&runtime.sequence_id) else {
                continue;
            };
            runtime.collect_output(sequence, &self.compiled.interner, &mut out);
            self.contribute_recipes(runtime, sequence, &mut out);
        }
        out
    }

    /// 让 sequence 上启用的配方 slot 贡献值。
    ///
    /// 未注册的 kind 直接跳过：show 文件里可能存着当前版本不认识的配方，
    /// 那不该让渲染失败。
    fn contribute_recipes(
        &self,
        runtime: &ExecutorRuntime,
        sequence: &CompiledSequence,
        out: &mut Vec<DmxOutputValue>,
    ) {
        if self.recipes.is_empty() || !runtime.is_active() {
            return;
        }

        let state = runtime.recipe_state();
        for slot in sequence.recipe_slots.iter().filter(|slot| slot.enabled) {
            let Some(engine) = self.recipes.get(&slot.engine_kind) else {
                continue;
            };

            let start = out.len();
            engine.contribute(
                &RecipeContext {
                    slot,
                    sequence,
                    interner: &self.compiled.interner,
                    local_time_ms: state.local_time_ms,
                    master: state.master,
                    order: state.order,
                },
                out,
            );

            // 配方只需给出值本身。优先级与排序依据由所属 sequence 和 executor
            // 决定，在这里统一盖上 —— 否则一个填错 priority 的配方就能
            // 掀翻整场演出的合并顺序。
            for value in &mut out[start..] {
                value.priority = sequence.priority;
                value.order = state.order;
            }
        }
    }

    /// 对某个 executor 执行一次回放动作。
    pub fn fire(&mut self, key: &ExecutorKey, action: PlaybackAction) -> bool {
        let Some(runtime) = self.executors.get_mut(key) else {
            return false;
        };
        let Some(sequence) = self.compiled.sequence(&runtime.sequence_id) else {
            return false;
        };

        match action {
            PlaybackAction::Go => runtime.go(sequence),
            PlaybackAction::Back => runtime.back(sequence),
            PlaybackAction::Pause => runtime.toggle_pause(),
            PlaybackAction::Off => runtime.off(sequence, &self.compiled.interner),
            PlaybackAction::Toggle => runtime.toggle(sequence, &self.compiled.interner),
            PlaybackAction::FlashOn => runtime.flash_on(sequence),
            PlaybackAction::FlashOff => runtime.flash_off(),
        }
        true
    }

    pub fn goto_cue(&mut self, key: &ExecutorKey, cue_id: &str) -> bool {
        let Some(runtime) = self.executors.get_mut(key) else {
            return false;
        };
        let Some(sequence) = self.compiled.sequence(&runtime.sequence_id) else {
            return false;
        };
        runtime.goto(sequence, cue_id)
    }

    /// 设置推子。这是纯运行时改动 —— 不触碰 show 文件。
    pub fn set_master(&mut self, key: &ExecutorKey, master: f64) -> bool {
        match self.executors.get_mut(key) {
            Some(runtime) => {
                runtime.set_master(master);
                true
            }
            None => false,
        }
    }

    pub fn set_rate(&mut self, key: &ExecutorKey, rate: f64) -> bool {
        match self.executors.get_mut(key) {
            Some(runtime) => {
                runtime.set_rate(rate);
                true
            }
            None => false,
        }
    }

    /// 对指派了某个 sequence 的所有 executor 执行动作。
    /// 命令行里 `Go Sequence 3` 这类不指定 executor 的写法走这里。
    pub fn fire_by_sequence(&mut self, sequence_id: &str, action: PlaybackAction) -> usize {
        let keys = self
            .executors
            .iter()
            .filter(|(_, runtime)| runtime.sequence_id == sequence_id)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        keys.iter()
            .filter(|key| self.fire(key, action))
            .count()
    }

    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            executors: self
                .executors
                .values()
                .map(|runtime| {
                    let sequence = self.compiled.sequence(&runtime.sequence_id);
                    ExecutorStateSnapshot {
                        page_id: runtime.key.page_id.clone(),
                        executor_id: runtime.key.executor_id.clone(),
                        sequence_id: runtime.sequence_id.clone(),
                        state: runtime.state,
                        current_cue_id: sequence
                            .and_then(|sequence| runtime.current_cue_id(sequence))
                            .map(str::to_string),
                        next_cue_id: sequence
                            .and_then(|sequence| runtime.next_cue_id(sequence))
                            .map(str::to_string),
                        master: runtime.master,
                        rate: runtime.rate,
                        flash: runtime.flash,
                    }
                })
                .collect(),
        }
    }

    /// 指派对象已经不存在时（sequence 被删掉），把实例一并清掉。
    fn prune_missing_sequences(&mut self) {
        let compiled = &self.compiled;
        self.executors
            .retain(|_, runtime| compiled.sequence(&runtime.sequence_id).is_some());
    }
}

impl std::fmt::Debug for PlaybackEngine {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PlaybackEngine")
            .field("version", &self.compiled.version)
            .field("executors", &self.executors.len())
            .field("recipes", &self.recipes)
            .finish()
    }
}
