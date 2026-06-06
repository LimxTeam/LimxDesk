use crate::{
    events, fixture_selection::FixtureSelectionState, output, programmer::ProgrammerState,
    show::ShowRuntimeState,
};
use limxdesk_cue::{CueStoreMode, CueValueLayer};
use limxdesk_dmx::{DmxChannelSource, DmxOutputValue};
use limxdesk_platform::current_timestamp_millis;
use limxdesk_programmer::StoreUseSelection;
use limxdesk_sequence::{
    advance_state, copy_cue_to_number, copy_sequence_to_number, cue_output_values, delete_cue,
    delete_sequence, goto_state, move_cue_to_number, move_sequence_to_number, normalize_document,
    off_state, select_sequence, set_master_state, store_programmer_values,
    store_single_step_program, update_cue, CuePatch, PlaybackDirection, SequenceCommandResult,
    SequenceDocument, SequenceRuntimeState, SequenceStoreRequest, SingleStepStoreRequest,
};
use limxdesk_showfile::LoadedShow;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, State};

const SEQUENCE_SECTION_KEY: &str = "sequence.v1";
const SEQUENCE_SECTION_VERSION: u16 = 1;

#[derive(Default)]
pub struct SequenceState {
    runtime: Mutex<HashMap<String, SequenceRuntimeState>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceRuntimeSnapshot {
    pub states: Vec<SequenceRuntimeState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceLoadResult {
    pub document: SequenceDocument,
    pub runtime: SequenceRuntimeSnapshot,
}

impl SequenceState {
    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "sequence runtime state lock poisoned".to_string())?;
        runtime.clear();
        Ok(())
    }

    pub(crate) fn snapshot(&self) -> Result<SequenceRuntimeSnapshot, String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "sequence runtime state lock poisoned".to_string())?;
        let mut states = runtime.values().cloned().collect::<Vec<_>>();
        states.sort_by(|left, right| left.sequence_id.cmp(&right.sequence_id));
        Ok(SequenceRuntimeSnapshot { states })
    }

    fn state_for(&self, sequence_id: &str) -> Result<Option<SequenceRuntimeState>, String> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| "sequence runtime state lock poisoned".to_string())?;
        Ok(runtime.get(sequence_id).cloned())
    }

    fn set_state(&self, state: SequenceRuntimeState) -> Result<SequenceRuntimeSnapshot, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "sequence runtime state lock poisoned".to_string())?;
        runtime.insert(state.sequence_id.clone(), state);
        let mut states = runtime.values().cloned().collect::<Vec<_>>();
        states.sort_by(|left, right| left.sequence_id.cmp(&right.sequence_id));
        Ok(SequenceRuntimeSnapshot { states })
    }

    fn remove_state(&self, sequence_id: &str) -> Result<SequenceRuntimeSnapshot, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "sequence runtime state lock poisoned".to_string())?;
        runtime.remove(sequence_id);
        let mut states = runtime.values().cloned().collect::<Vec<_>>();
        states.sort_by(|left, right| left.sequence_id.cmp(&right.sequence_id));
        Ok(SequenceRuntimeSnapshot { states })
    }
}

#[tauri::command]
pub fn sequence_load_current_show(
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
) -> Result<SequenceLoadResult, String> {
    let Some(_show) = show_state.current()? else {
        return Ok(SequenceLoadResult {
            document: SequenceDocument::default(),
            runtime: sequence_state.snapshot()?,
        });
    };

    Ok(SequenceLoadResult {
        document: load_sequence_document(&show_state)?,
        runtime: sequence_state.snapshot()?,
    })
}

#[tauri::command]
pub fn sequence_create(
    name: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before editing sequences.".to_string());
    };
    let now = now_ms()?;
    let result = limxdesk_sequence::create_sequence(load_sequence_document(&show_state)?, name, now)
        .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &app)?;
    Ok(result)
}

#[tauri::command]
pub fn sequence_select(
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = select_sequence(load_sequence_document(&show_state)?, &sequence_id)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn sequence_delete(
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = delete_sequence(load_sequence_document(&show_state)?, &sequence_id)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    let snapshot = sequence_state.remove_state(&sequence_id)?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn sequence_copy(
    source_number: u32,
    target_number: u32,
    show_state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let document = copy_sequence_to_number(
        load_sequence_document(&show_state)?,
        source_number,
        target_number,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn sequence_move(
    source_number: u32,
    target_number: u32,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceDocument, String> {
    let before = load_sequence_document(&show_state)?;
    let source_id = before
        .sequences
        .iter()
        .find(|sequence| sequence.number == source_number)
        .map(|sequence| sequence.id.clone());
    let document = move_sequence_to_number(before, source_number, target_number, now_ms()?)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    if let Some(source_id) = source_id {
        let snapshot = sequence_state.remove_state(&source_id)?;
        events::emit_sequence_state_changed(&app, &snapshot);
    }
    request_sequence_output(&app);
    Ok(document)
}

#[tauri::command]
pub fn sequence_store_programmer(
    request: SequenceStoreRequest,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before storing cues.".to_string());
    };
    let selection = selection_state.current()?;
    let values = programmer_state
        .current()?
        .store_values(StoreUseSelection::Active, &selection);
    let result = store_programmer_values(
        load_sequence_document(&show_state)?,
        request,
        values,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &app)?;
    Ok(result)
}

#[tauri::command]
pub fn sequence_store_single_step_program(
    request: SingleStepStoreRequest,
    show_state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before storing programs.".to_string());
    };
    let selection = selection_state.current()?;
    let values = programmer_state
        .current()?
        .store_values(StoreUseSelection::Active, &selection);
    let result = store_single_step_program(
        load_sequence_document(&show_state)?,
        request,
        values,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &app)?;
    Ok(result)
}

#[tauri::command]
pub fn sequence_update_cue(
    sequence_id: String,
    cue_id: String,
    patch: CuePatch,
    show_state: State<'_, ShowRuntimeState>,
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
    save_and_emit(&result.document, &show_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_delete_cue(
    sequence_id: String,
    cue_id: String,
    show_state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<SequenceCommandResult, String> {
    let result = delete_cue(load_sequence_document(&show_state)?, &sequence_id, &cue_id, now_ms()?)
        .map_err(|error| error.to_string())?;
    save_and_emit(&result.document, &show_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_copy_cue(
    sequence_id: String,
    source_number: f64,
    target_number: f64,
    show_state: State<'_, ShowRuntimeState>,
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
    save_and_emit(&result.document, &show_state, &app)?;
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_move_cue(
    sequence_id: String,
    source_number: f64,
    target_number: f64,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
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
    save_and_emit(&result.document, &show_state, &app)?;
    let state = sequence_state.state_for(&sequence_id)?;
    if let Some(mut state) = state {
        state.current_cue_id = None;
        state.next_cue_id = result.sequence.cues.first().map(|cue| cue.id.clone());
        let snapshot = sequence_state.set_state(state)?;
        events::emit_sequence_state_changed(&app, &snapshot);
    }
    request_sequence_output(&app);
    Ok(result)
}

#[tauri::command]
pub fn sequence_go(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    run_sequence_direction(sequence_id, PlaybackDirection::Go, show_state, sequence_state, app)
}

#[tauri::command]
pub fn sequence_back(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    run_sequence_direction(sequence_id, PlaybackDirection::Back, show_state, sequence_state, app)
}

#[tauri::command]
pub fn sequence_goto_cue(
    sequence_id: String,
    cue_id: String,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    let document = load_sequence_document(&show_state)?;
    let sequence = resolve_sequence(&document, Some(sequence_id.clone()))?;
    let state = goto_state(
        sequence,
        sequence_state.state_for(&sequence_id)?,
        &cue_id,
        now_ms()?,
    )
    .map_err(|error| error.to_string())?;
    let snapshot = sequence_state.set_state(state)?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn sequence_off(
    sequence_id: Option<String>,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    let document = load_sequence_document(&show_state)?;
    let sequence = resolve_sequence(&document, sequence_id)?;
    let state = off_state(&sequence.id, sequence_state.state_for(&sequence.id)?, now_ms()?);
    let snapshot = sequence_state.set_state(state)?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

#[tauri::command]
pub fn sequence_set_master(
    sequence_id: String,
    master: f64,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    let state = set_master_state(
        &sequence_id,
        sequence_state.state_for(&sequence_id)?,
        master,
        now_ms()?,
    );
    let snapshot = sequence_state.set_state(state)?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

pub(crate) fn active_sequence_output_values(
    show_state: &State<'_, ShowRuntimeState>,
    sequence_state: &State<'_, SequenceState>,
) -> Result<Vec<DmxOutputValue>, String> {
    let Some(_show) = show_state.current()? else {
        return Ok(Vec::new());
    };
    let document = load_sequence_document(show_state)?;
    let states = sequence_state.snapshot()?.states;
    let mut output_values = Vec::new();
    for state in states {
        let Some(sequence) = document.sequences.iter().find(|sequence| sequence.id == state.sequence_id) else {
            continue;
        };
        output_values.extend(
            cue_output_values(sequence, &state)
                .into_iter()
                .filter(|value| matches!(value.layer, CueValueLayer::Absolute))
                .map(|value| DmxOutputValue {
                    fixture_id: value.fixture_id,
                    attribute: value.attribute,
                    numeric: value.numeric,
                    active: value.active,
                    source: DmxChannelSource::Sequence,
                }),
        );
    }
    Ok(output_values)
}

pub(crate) fn load_sequence_document(
    state: &State<'_, ShowRuntimeState>,
) -> Result<SequenceDocument, String> {
    let document = state
        .read_section::<SequenceDocument>(SEQUENCE_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

fn run_sequence_direction(
    sequence_id: Option<String>,
    direction: PlaybackDirection,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<SequenceRuntimeSnapshot, String> {
    let document = load_sequence_document(&show_state)?;
    let sequence = resolve_sequence(&document, sequence_id)?;
    let state = advance_state(
        sequence,
        sequence_state.state_for(&sequence.id)?,
        direction,
        now_ms()?,
    );
    let snapshot = sequence_state.set_state(state)?;
    events::emit_sequence_state_changed(&app, &snapshot);
    request_sequence_output(&app);
    Ok(snapshot)
}

fn resolve_sequence(
    document: &SequenceDocument,
    sequence_id: Option<String>,
) -> Result<&limxdesk_sequence::Sequence, String> {
    let id = sequence_id
        .or(document.selected_sequence_id.clone())
        .or_else(|| document.sequences.first().map(|sequence| sequence.id.clone()))
        .ok_or_else(|| "no sequence exists".to_string())?;
    document
        .sequences
        .iter()
        .find(|sequence| sequence.id == id)
        .ok_or_else(|| format!("sequence not found: {id}"))
}

fn save_and_emit(
    document: &SequenceDocument,
    show_state: &State<'_, ShowRuntimeState>,
    app: &AppHandle,
) -> Result<LoadedShow, String> {
    let saved = save_sequence_document(document, show_state)?;
    events::emit_sequence_changed(app, &saved);
    Ok(saved)
}

fn save_sequence_document(
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
    app: &AppHandle,
) -> Result<LoadedShow, String> {
    save_and_emit(document, show_state, app)
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
