// ============================================================
// 文件名称：recipe.rs
// 功能描述：SequenceRecipeSlot 的消费契约
//
// 效果引擎按 kind 注册，渲染时被调用来贡献值。一次调用对应一个效果实例：
// 引擎拿到模板 id、作用灯具与参数覆盖，产出这一瞬的值。
//
// 这里不认识任何具体的效果种类 —— 关键帧只是其中一种，注册发生在装配层。
// ============================================================

use crate::interner::Interner;
use limxdesk_dmx::DmxOutputValue;
use limxdesk_effect::AppliedEffect;
use std::collections::HashMap;
use std::sync::Arc;

/// 引擎调用效果时给出的 executor 侧状态。
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
    /// 要求值的效果实例：模板 id、作用灯具、参数覆盖都在里面。
    pub applied: &'a AppliedEffect,
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
