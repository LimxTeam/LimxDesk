// ============================================================
// 文件名称：engine.rs
// 功能描述：回放引擎的 Tauri 状态封装
//
// 编译产物的更新是"推"而不是"拉"：文档被写入时主动通知引擎重编译，
// 渲染路径因此完全不需要访问 show 文档。过去每帧都要把整份
// SequenceDocument 反序列化一遍才能求值，那部分工作在这里消失。
// ============================================================

use limxdesk_dmx::DmxOutputValue;
use limxdesk_engine::{EngineSnapshot, ExecutorKey, Motion, PlaybackEngine};
use limxdesk_playback::{PlaybackAction, PlaybackDocument};
use limxdesk_sequence::SequenceDocument;
use std::sync::Mutex;

#[derive(Default)]
pub struct EngineState {
    engine: Mutex<PlaybackEngine>,
}

impl EngineState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, PlaybackEngine>, String> {
        self.engine
            .lock()
            .map_err(|_| "playback engine state lock poisoned".to_string())
    }

    /// 注册一种效果引擎。
    ///
    /// 引擎种类由装配层决定，回放引擎自身不认识任何具体效果。
    pub(crate) fn register_recipe(
        &self,
        engine: std::sync::Arc<dyn limxdesk_engine::RecipeEngine>,
    ) -> Result<(), String> {
        self.lock()?.recipes_mut().register(engine);
        Ok(())
    }

    /// sequence 文档写入后重新编译。
    pub(crate) fn reload_sequences(&self, document: &SequenceDocument) -> Result<(), String> {
        self.lock()?.reload_document(document);
        Ok(())
    }

    /// playback 文档写入后同步 executor 实例表。
    pub(crate) fn sync_assignments(&self, document: &PlaybackDocument) -> Result<(), String> {
        self.lock()?.sync_assignments(document);
        Ok(())
    }

    /// 换 show 时把两份文档一起装上，并清掉全部播放状态。
    pub(crate) fn reload_all(
        &self,
        sequences: &SequenceDocument,
        playback: &PlaybackDocument,
    ) -> Result<(), String> {
        let mut engine = self.lock()?;
        engine.clear();
        engine.reload_document(sequences);
        engine.sync_assignments(playback);
        Ok(())
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        self.lock()?.clear();
        Ok(())
    }

    pub(crate) fn tick(&self, now_ms: u64) -> Result<Motion, String> {
        Ok(self.lock()?.tick(now_ms))
    }

    pub(crate) fn collect_output(&self) -> Result<Vec<DmxOutputValue>, String> {
        Ok(self.lock()?.collect_output())
    }

    pub(crate) fn snapshot(&self) -> Result<EngineSnapshot, String> {
        Ok(self.lock()?.snapshot())
    }

    pub(crate) fn fire(&self, key: &ExecutorKey, action: PlaybackAction) -> Result<bool, String> {
        Ok(self.lock()?.fire(key, action))
    }

    pub(crate) fn fire_by_sequence(
        &self,
        sequence_id: &str,
        action: PlaybackAction,
    ) -> Result<usize, String> {
        Ok(self.lock()?.fire_by_sequence(sequence_id, action))
    }

    pub(crate) fn goto_cue(&self, key: &ExecutorKey, cue_id: &str) -> Result<bool, String> {
        Ok(self.lock()?.goto_cue(key, cue_id))
    }

    /// 对指派了某 sequence 的所有 executor 跳到指定 cue。
    pub(crate) fn goto_cue_by_sequence(
        &self,
        sequence_id: &str,
        cue_id: &str,
    ) -> Result<usize, String> {
        let mut engine = self.lock()?;
        let keys = engine
            .snapshot()
            .executors
            .into_iter()
            .filter(|state| state.sequence_id == sequence_id)
            .map(|state| ExecutorKey::new(state.page_id, state.executor_id))
            .collect::<Vec<_>>();
        Ok(keys
            .iter()
            .filter(|key| engine.goto_cue(key, cue_id))
            .count())
    }

    /// 设置推子。纯运行时改动，不落盘 —— 推子是连续控制，
    /// 每一次移动都写 show 文件是过去的一个明确缺陷。
    pub(crate) fn set_master(&self, key: &ExecutorKey, master: f64) -> Result<bool, String> {
        Ok(self.lock()?.set_master(key, master))
    }

    pub(crate) fn set_master_by_sequence(
        &self,
        sequence_id: &str,
        master: f64,
    ) -> Result<usize, String> {
        let mut engine = self.lock()?;
        let keys = engine
            .snapshot()
            .executors
            .into_iter()
            .filter(|state| state.sequence_id == sequence_id)
            .map(|state| ExecutorKey::new(state.page_id, state.executor_id))
            .collect::<Vec<_>>();
        Ok(keys
            .iter()
            .filter(|key| engine.set_master(key, master))
            .count())
    }

    pub(crate) fn set_rate(&self, key: &ExecutorKey, rate: f64) -> Result<bool, String> {
        Ok(self.lock()?.set_rate(key, rate))
    }
}
