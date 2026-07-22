use crate::{
    engine::EngineState, events, fixture_selection::FixtureSelectionState, output,
    programmer::ProgrammerState, sequence, show::ShowRuntimeState,
};
use limxdesk_cue::CueStoreMode;
use limxdesk_engine::{EngineSnapshot, ExecutorKey};
use limxdesk_playback::{
    assign_executor, clear_executor, copy_executor, find_executor, move_executor,
    normalize_document, set_executor_master, ExecutorAssignment, ExecutorAssignmentKind,
    PlaybackAction, PlaybackDocument,
};
use limxdesk_programmer::StoreUseSelection;
use limxdesk_sequence::{store_single_step_program, SequenceCommandResult, SingleStepStoreRequest};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

const PLAYBACK_SECTION_KEY: &str = "playback.v1";
const PLAYBACK_SECTION_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStoreExecutorResult {
    pub playback: PlaybackDocument,
    pub sequence: SequenceCommandResult,
}

#[tauri::command]
pub fn playback_load_current_show(
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
) -> Result<PlaybackDocument, String> {
    let document = load_playback_document(&show_state)?;
    engine_state.sync_assignments(&document)?;
    Ok(document)
}

#[tauri::command]
pub fn playback_replace_current_show(
    document: PlaybackDocument,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing playback.".to_string(),
        );
    };
    let document = normalize_document(document);
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    request_playback_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn playback_assign_executor(
    page_id: String,
    executor_id: String,
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let sequence_document = sequence::load_sequence_document(&show_state)?;
    let sequence = sequence_document
        .sequences
        .iter()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| format!("sequence not found: {sequence_id}"))?;
    let assignment = ExecutorAssignment {
        kind: ExecutorAssignmentKind::Sequence,
        object_id: sequence.id.clone(),
        object_name: sequence.name.clone(),
    };
    let document = assign_executor(
        load_playback_document(&show_state)?,
        &page_id,
        &executor_id,
        assignment,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn playback_store_programmer_on_executor(
    page_id: String,
    executor_id: String,
    store_mode: CueStoreMode,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackStoreExecutorResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing playback.".to_string(),
        );
    };

    let playback_document = load_playback_document(&show_state)?;
    let executor = find_executor(&playback_document, &page_id, &executor_id)
        .map_err(|error| error.to_string())?
        .clone();
    let existing_sequence_id = executor
        .assignment
        .as_ref()
        .and_then(|assignment| match assignment.kind {
            ExecutorAssignmentKind::Sequence => Some(assignment.object_id.clone()),
        });
    let selection = selection_state.current()?;
    let values = programmer_state
        .current()?
        .store_values(StoreUseSelection::Active, &selection);
    let sequence_result = store_single_step_program(
        sequence::load_sequence_document(&show_state)?,
        SingleStepStoreRequest {
            sequence_id: existing_sequence_id,
            sequence_number: None,
            name: Some(if executor.label.trim().is_empty() {
                format!("Executor {}", executor.number)
            } else {
                executor.label.clone()
            }),
            store_mode,
        },
        values,
        sequence::now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    sequence::save_and_emit_sequence_document(
        &sequence_result.document,
        &show_state,
        &engine_state,
        &app,
    )?;

    let assignment = ExecutorAssignment {
        kind: ExecutorAssignmentKind::Sequence,
        object_id: sequence_result.sequence.id.clone(),
        object_name: sequence_result.sequence.name.clone(),
    };
    let playback_document = assign_executor(playback_document, &page_id, &executor_id, assignment)
        .map_err(|error| error.to_string())?;
    save_and_emit(&playback_document, &show_state, &engine_state, &app)?;
    request_playback_output(&app);
    Ok(PlaybackStoreExecutorResult {
        playback: playback_document,
        sequence: sequence_result,
    })
}

#[tauri::command]
pub fn playback_clear_executor(
    page_id: String,
    executor_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let document = clear_executor(load_playback_document(&show_state)?, &page_id, &executor_id)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    request_playback_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn playback_copy_executor(
    page_id: String,
    source_executor_id: String,
    target_executor_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let document = copy_executor(
        load_playback_document(&show_state)?,
        &page_id,
        &source_executor_id,
        &target_executor_id,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn playback_move_executor(
    page_id: String,
    source_executor_id: String,
    target_executor_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let document = move_executor(
        load_playback_document(&show_state)?,
        &page_id,
        &source_executor_id,
        &target_executor_id,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    request_playback_output(&app);
    Ok(document)
}

/// 触发一个 executor 上的回放动作。
///
/// 动作直接交给引擎，不再转译成对 sequence 的调用 —— 播放头属于 executor，
/// 同一个 sequence 挂在两个 executor 上时各走各的。
#[tauri::command]
pub fn playback_fire_executor(
    page_id: String,
    executor_id: String,
    action: PlaybackAction,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    let key = ExecutorKey::new(page_id, executor_id);
    engine_state.fire(&key, action)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_playback_state_changed(&app, &snapshot);
    request_playback_output(&app);
    Ok(snapshot)
}

/// 跳到指定 cue。
#[tauri::command]
pub fn playback_goto_cue(
    page_id: String,
    executor_id: String,
    cue_id: String,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    let key = ExecutorKey::new(page_id, executor_id);
    engine_state.goto_cue(&key, &cue_id)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_playback_state_changed(&app, &snapshot);
    request_playback_output(&app);
    Ok(snapshot)
}

/// 设置 executor 推子。
///
/// 只改运行时值，不写 show 文件：推子是连续控制，过去每移动一次就把整个
/// playback section 序列化落盘一次。文档里的推子值是上电默认值，
/// 由显式的保存动作更新。
#[tauri::command]
pub fn playback_set_executor_master(
    page_id: String,
    executor_id: String,
    master: f64,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    let key = ExecutorKey::new(page_id, executor_id);
    engine_state.set_master(&key, master)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_playback_state_changed(&app, &snapshot);
    request_playback_output(&app);
    Ok(snapshot)
}

/// 设置 executor 速率。同样只改运行时值。
#[tauri::command]
pub fn playback_set_executor_rate(
    page_id: String,
    executor_id: String,
    rate: f64,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    let key = ExecutorKey::new(page_id, executor_id);
    engine_state.set_rate(&key, rate)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_playback_state_changed(&app, &snapshot);
    request_playback_output(&app);
    Ok(snapshot)
}

/// 把当前运行时推子值固化进 show 文档，作为下次加载的初值。
#[tauri::command]
pub fn playback_persist_executor_master(
    page_id: String,
    executor_id: String,
    master: f64,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let (document, _assignment) = set_executor_master(
        load_playback_document(&show_state)?,
        &page_id,
        &executor_id,
        master,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

/// 读取引擎当前的回放状态。
#[tauri::command]
pub fn playback_runtime_snapshot(
    engine_state: State<'_, EngineState>,
) -> Result<EngineSnapshot, String> {
    engine_state.snapshot()
}

pub(crate) fn load_playback_document(state: &State<'_, ShowRuntimeState>) -> Result<PlaybackDocument, String> {
    let Some(_show) = state.current()? else {
        return Ok(normalize_document(PlaybackDocument::default()));
    };
    let document = state
        .read_section::<PlaybackDocument>(PLAYBACK_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

/// 写入 playback section 并让引擎的实例表跟上。
///
/// 编译产物是"推"过去的：所有会改变指派的路径都经过这里，渲染路径因此
/// 完全不必再读文档。
fn save_and_emit(
    document: &PlaybackDocument,
    show_state: &State<'_, ShowRuntimeState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<(), String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing playback.".to_string(),
        );
    };
    let saved =
        show_state.write_section(PLAYBACK_SECTION_KEY, PLAYBACK_SECTION_VERSION, document)?;
    engine_state.sync_assignments(document)?;
    events::emit_playback_changed(app, &saved);
    Ok(())
}

fn request_playback_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request output after playback change: {error}");
    }
}
