// ============================================================
// 文件名称：sequence.rs
// 功能描述：sequence 文档的 invoke 命令
//
// 这一层只负责文档的增删改查与落盘。回放状态属于 engine —— sequence 是
// 内容容器，播放头挂在 executor 上。文档每次写入后主动通知引擎重编译，
// 渲染路径因此完全不需要读文档。
//
// sequence_go / back / off 这类命令保留下来给命令行用（"Go Sequence 3"）：
// 它们作用在所有指派了该 sequence 的 executor 上。
// ============================================================

use crate::{
    engine::EngineState, events, fixture_selection::FixtureSelectionState, output,
    programmer::ProgrammerState, show::ShowRuntimeState,
};
use limxdesk_cue::CueStoreMode;
use limxdesk_engine::EngineSnapshot;
use limxdesk_platform::current_timestamp_millis;
use limxdesk_playback::PlaybackAction;
use limxdesk_programmer::StoreUseSelection;
use limxdesk_sequence::{
    copy_cue_to_number, copy_sequence_to_number, delete_cue, delete_sequence, move_cue_to_number,
    move_sequence_to_number, normalize_document, select_sequence, update_cue, CuePatch,
    SequenceCommandResult, SequenceDocument, SequenceStoreRequest, SingleStepStoreRequest,
};
use limxdesk_showfile::LoadedShow;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

const SEQUENCE_SECTION_KEY: &str = "sequence.v1";
const SEQUENCE_SECTION_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceLoadResult {
    pub document: SequenceDocument,
    pub runtime: EngineSnapshot,
}

#[tauri::command]
pub fn sequence_load_current_show(
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
) -> Result<SequenceLoadResult, String> {
    let Some(_show) = show_state.current()? else {
        return Ok(SequenceLoadResult {
            document: SequenceDocument::default(),
            runtime: engine_state.snapshot()?,
        });
    };

    let document = load_sequence_document(&show_state)?;
    engine_state.reload_sequences(&document)?;
    Ok(SequenceLoadResult {
        document,
        runtime: engine_state.snapshot()?,
    })
}

#[tauri::command]
pub fn sequence_replace_current_show(
    document: SequenceDocument,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing sequences.".to_string(),
        );
    };
    let document = normalize_document(document);
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    engine_state.clear()?;
    engine_state.reload_sequences(&document)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn sequence_create(
    name: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing sequences.".to_string(),
        );
    };
    let now = now_ms()?;
    let result =
        limxdesk_sequence::create_sequence(load_sequence_document(&show_state)?, name, now)
            .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    Ok(result)
}

#[tauri::command]
pub fn sequence_select(
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = select_sequence(load_sequence_document(&show_state)?, &sequence_id)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn sequence_delete(
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = delete_sequence(load_sequence_document(&show_state)?, &sequence_id)
        .map_err(|error| error.to_string())?;
    // reload 会把指向已删除 sequence 的 executor 实例一并清掉。
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn sequence_copy(
    source_number: u32,
    target_number: u32,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = copy_sequence_to_number(
        load_sequence_document(&show_state)?,
        source_number,
        target_number,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn sequence_move(
    source_number: u32,
    target_number: u32,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = move_sequence_to_number(
        load_sequence_document(&show_state)?,
        source_number,
        target_number,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &engine_state, &app)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn sequence_store_programmer(
    request: SequenceStoreRequest,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before storing cues.".to_string());
    };
    let selection = selection_state.current()?;
    let programmer = programmer_state.current()?;
    let values = programmer.store_values(StoreUseSelection::Active, &selection);
    let effects = programmer.store_effects(StoreUseSelection::Active, &selection);
    let result = limxdesk_sequence::store_programmer_content(
        load_sequence_document(&show_state)?,
        request,
        values,
        effects,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_store_single_step_program(
    request: SingleStepStoreRequest,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before storing programs.".to_string(),
        );
    };
    let selection = selection_state.current()?;
    let programmer = programmer_state.current()?;
    let values = programmer.store_values(StoreUseSelection::Active, &selection);
    let effects = programmer.store_effects(StoreUseSelection::Active, &selection);
    let result = limxdesk_sequence::store_single_step_content(
        load_sequence_document(&show_state)?,
        request,
        values,
        effects,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_update_cue(
    sequence_id: String,
    cue_id: String,
    patch: CuePatch,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let result = update_cue(
        load_sequence_document(&show_state)?,
        &sequence_id,
        &cue_id,
        patch,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_delete_cue(
    sequence_id: String,
    cue_id: String,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let result = delete_cue(
        load_sequence_document(&show_state)?,
        &sequence_id,
        &cue_id,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_copy_cue(
    sequence_id: String,
    source_number: f64,
    target_number: f64,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let result = copy_cue_to_number(
        load_sequence_document(&show_state)?,
        &sequence_id,
        source_number,
        target_number,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_move_cue(
    sequence_id: String,
    source_number: f64,
    target_number: f64,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let result = move_cue_to_number(
        load_sequence_document(&show_state)?,
        &sequence_id,
        source_number,
        target_number,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &engine_state, &app)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_go(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    fire_by_sequence(sequence_id, PlaybackAction::Go, &show_state, &engine_state, &app)
}

#[tauri::command]
pub fn sequence_back(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    fire_by_sequence(
        sequence_id,
        PlaybackAction::Back,
        &show_state,
        &engine_state,
        &app,
    )
}

#[tauri::command]
pub fn sequence_off(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    fire_by_sequence(
        sequence_id,
        PlaybackAction::Off,
        &show_state,
        &engine_state,
        &app,
    )
}

#[tauri::command]
pub fn sequence_goto_cue(
    sequence_id: String,
    cue_id: String,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    engine_state.goto_cue_by_sequence(&sequence_id, &cue_id)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn sequence_set_master(
    sequence_id: String,
    master: f64,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<EngineSnapshot, String> {
    engine_state.set_master_by_sequence(&sequence_id, master)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

/// 对所有指派了目标 sequence 的 executor 执行动作。
///
/// 不给 sequence_id 时落到文档里当前选中的那个 —— 命令行不带地址的
/// `Go` 就是这个语义。
fn fire_by_sequence(
    sequence_id: Option<String>,
    action: PlaybackAction,
    show_state: &State<'_, ShowRuntimeState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<EngineSnapshot, String> {
    let document = load_sequence_document(show_state)?;
    let target = sequence_id
        .or(document.selected_sequence_id.clone())
        .or_else(|| {
            document
                .sequences
                .first()
                .map(|sequence| sequence.id.clone())
        })
        .ok_or_else(|| "no sequence exists".to_string())?;

    engine_state.fire_by_sequence(&target, action)?;
    let snapshot = engine_state.snapshot()?;
    events::emit_sequence_state_changed(app, &snapshot);
    request_sequence_output(app);
    Ok(snapshot)
}

pub(crate) fn load_sequence_document(
    state: &State<'_, ShowRuntimeState>,
) -> Result<SequenceDocument, String> {
    let document = state
        .read_section::<SequenceDocument>(SEQUENCE_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

/// 写入 sequence section 并让引擎重新编译。
///
/// 重编译发生在这里而不是渲染路径上：内容变了才需要重新展开 tracking，
/// 而内容只在这一处改变。
fn save_and_emit(
    document: &SequenceDocument,
    show_state: &State<'_, ShowRuntimeState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<LoadedShow, String> {
    let saved = state_write(document, show_state)?;
    engine_state.reload_sequences(document)?;
    events::emit_sequence_changed(app, &saved);
    Ok(saved)
}

fn state_write(
    document: &SequenceDocument,
    state: &State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    state.write_section(SEQUENCE_SECTION_KEY, SEQUENCE_SECTION_VERSION, document)
}

fn request_sequence_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request output after sequence change: {error}");
    }
}

pub(crate) fn save_and_emit_sequence_document(
    document: &SequenceDocument,
    show_state: &State<'_, ShowRuntimeState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<LoadedShow, String> {
    save_and_emit(document, show_state, engine_state, app)
}


pub(crate) fn now_ms() -> Result<u64, String> {
    current_timestamp_millis().map_err(|error| error.to_string())
}

#[allow(dead_code)]
fn _default_store_request() -> SequenceStoreRequest {
    SequenceStoreRequest {
        sequence_id: None,
        cue_id: None,
        cue_number: None,
        cue_name: None,
        store_mode: CueStoreMode::Merge,
    }
}
