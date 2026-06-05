use crate::{events, output, sequence, sequence::SequenceState, show::ShowRuntimeState};
use limxdesk_playback::{
    assign_executor, clear_executor, find_executor, normalize_document, set_executor_master,
    ExecutorAssignment, ExecutorAssignmentKind, PlaybackAction, PlaybackDocument,
};
use tauri::{AppHandle, State};

const PLAYBACK_SECTION_KEY: &str = "playback.v1";
const PLAYBACK_SECTION_VERSION: u16 = 1;

#[tauri::command]
pub fn playback_load_current_show(
    show_state: State<'_, ShowRuntimeState>,
) -> Result<PlaybackDocument, String> {
    load_playback_document(&show_state)
}

#[tauri::command]
pub fn playback_assign_executor(
    page_id: String,
    executor_id: String,
    sequence_id: String,
    show_state: State<'_, ShowRuntimeState>,
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
    let document = assign_executor(load_playback_document(&show_state)?, &page_id, &executor_id, assignment)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn playback_clear_executor(
    page_id: String,
    executor_id: String,
    show_state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let document = clear_executor(load_playback_document(&show_state)?, &page_id, &executor_id)
        .map_err(|error| error.to_string())?;
    save_and_emit(&document, &show_state, &app)?;
    Ok(document)
}

#[tauri::command]
pub fn playback_fire_executor(
    page_id: String,
    executor_id: String,
    action: PlaybackAction,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<sequence::SequenceRuntimeSnapshot, String> {
    let document = load_playback_document(&show_state)?;
    let executor = find_executor(&document, &page_id, &executor_id).map_err(|error| error.to_string())?;
    let Some(assignment) = executor.assignment.as_ref() else {
        return Ok(sequence_state.snapshot()?);
    };
    match assignment.kind {
        ExecutorAssignmentKind::Sequence => match action {
            PlaybackAction::Go | PlaybackAction::Toggle | PlaybackAction::FlashOn => sequence::sequence_go(
                Some(assignment.object_id.clone()),
                show_state,
                sequence_state,
                app,
            ),
            PlaybackAction::Back => sequence::sequence_back(
                Some(assignment.object_id.clone()),
                show_state,
                sequence_state,
                app,
            ),
            PlaybackAction::Off | PlaybackAction::FlashOff => sequence::sequence_off(
                Some(assignment.object_id.clone()),
                show_state,
                sequence_state,
                app,
            ),
            PlaybackAction::Pause => {
                let snapshot = sequence_state.snapshot()?;
                events::emit_playback_state_changed(&app, &snapshot);
                Ok(snapshot)
            }
        },
    }
}

#[tauri::command]
pub fn playback_set_executor_master(
    page_id: String,
    executor_id: String,
    master: f64,
    show_state: State<'_, ShowRuntimeState>,
    sequence_state: State<'_, SequenceState>,
    app: AppHandle,
) -> Result<PlaybackDocument, String> {
    let (document, assignment) = set_executor_master(
        load_playback_document(&show_state)?,
        &page_id,
        &executor_id,
        master,
    )
    .map_err(|error| error.to_string())?;
    if let Some(assignment) = assignment {
        match assignment.kind {
            ExecutorAssignmentKind::Sequence => {
                let snapshot = sequence::sequence_set_master(
                    assignment.object_id,
                    master,
                    sequence_state,
                    app.clone(),
                )?;
                events::emit_playback_state_changed(&app, &snapshot);
            }
        }
    }
    save_and_emit(&document, &show_state, &app)?;
    request_playback_output(&app);
    Ok(document)
}

fn load_playback_document(state: &State<'_, ShowRuntimeState>) -> Result<PlaybackDocument, String> {
    let Some(_show) = state.current()? else {
        return Ok(normalize_document(PlaybackDocument::default()));
    };
    let document = state
        .read_section::<PlaybackDocument>(PLAYBACK_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

fn save_and_emit(
    document: &PlaybackDocument,
    show_state: &State<'_, ShowRuntimeState>,
    app: &AppHandle,
) -> Result<(), String> {
    let Some(_show) = show_state.current()? else {
        return Err("No show file loaded. Create or load a show before editing playback.".to_string());
    };
    let saved = show_state.write_section(PLAYBACK_SECTION_KEY, PLAYBACK_SECTION_VERSION, document)?;
    events::emit_playback_changed(app, &saved);
    Ok(())
}

fn request_playback_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request output after playback change: {error}");
    }
}
