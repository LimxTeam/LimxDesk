// ============================================================
// 文件名称：recipe.rs
// 功能描述：SequenceRecipeSlot 的消费契约
//
// SequenceRecipeSlot 一直带着 engine_kind 字段却没有任何消费方 —— 存得下、
// 读得出，但渲染管线从不看它。这里给它一个明确的契约：配方引擎按 kind 注册，
// 渲染时被调用来贡献值。
//
// 这里刻意不实现任何具体的效果引擎。契约只规定"一个 slot 如何参与渲染"，
// 至于效果本身怎么建模（相位、波形、分组方式）属于效果系统的设计，
// 单独讨论后再来填。
// ============================================================

use crate::compiled::CompiledSequence;
use crate::interner::Interner;
use limxdesk_dmx::DmxOutputValue;
use limxdesk_sequence::SequenceRecipeSlot;
use std::collections::HashMap;
use std::sync::Arc;

/// 引擎调用配方时给出的 executor 侧状态。
#[derive(Clone, Copy, Debug)]
pub struct RecipeExecutorState {
    /// 所属 executor 的本地时间（毫秒，已按 rate 缩放）。效果是时间的函数，
    /// 这就是那个 t。
    pub local_time_ms: f64,
    /// 所属 executor 的实际推子值（flash 期间为满）。
    pub master: f64,
    /// 所属 executor 的排序依据。
    pub order: u32,
}

/// 调用配方引擎时的上下文。
pub struct RecipeContext<'a> {
    pub slot: &'a SequenceRecipeSlot,
    pub sequence: &'a CompiledSequence,
    pub interner: &'a Interner,
    /// 所属 executor 的本地时间（毫秒，已按 rate 缩放）。
    /// 效果是时间的函数，这就是那个 t。
    pub local_time_ms: f64,
    /// 所属 executor 的推子值。
    pub master: f64,
    /// 所属 executor 的排序依据，用于 LTP 平局。
    pub order: u32,
}

/// 一个能向渲染管线贡献值的配方引擎。
pub trait RecipeEngine: Send + Sync {
    /// 与 `SequenceRecipeSlot::engine_kind` 对应的标识。
    fn kind(&self) -> &str;

    /// 贡献这一瞬的值。实现方应当追加而不是清空 `out`。
    fn contribute(&self, context: &RecipeContext<'_>, out: &mut Vec<DmxOutputValue>);
}

/// kind → 引擎的注册表。
#[derive(Clone, Default)]
pub struct RecipeRegistry {
    engines: HashMap<String, Arc<dyn RecipeEngine>>,
}

impl RecipeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, engine: Arc<dyn RecipeEngine>) {
        self.engines.insert(engine.kind().to_string(), engine);
    }

    pub fn get(&self, kind: &str) -> Option<&Arc<dyn RecipeEngine>> {
        self.engines.get(kind)
    }

    pub fn is_empty(&self) -> bool {
        self.engines.is_empty()
    }

    pub fn kinds(&self) -> impl Iterator<Item = &str> {
        self.engines.keys().map(String::as_str)
    }
}

impl std::fmt::Debug for RecipeRegistry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RecipeRegistry")
            .field("kinds", &self.engines.keys().collect::<Vec<_>>())
            .finish()
    }
}
