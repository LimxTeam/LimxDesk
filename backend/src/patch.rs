use crate::{
    events, fixture_selection::FixtureSelectionState, output, programmer,
    programmer::ProgrammerState, show::ShowRuntimeState,
};
use limxdesk_patch::{
    apply_wizard, auto_patch, delete_fixture, duplicate_fixture, normalize_document,
    update_fixture, validate_fixtures, FixtureTypeRef, PatchCommandResult, PatchDocument,
    PatchFixturePatch, PatchWizardDraft,
};
use limxdesk_showfile::LoadedShow;
use tauri::{AppHandle, State};

const PATCH_SECTION_KEY: &str = "patch.v1";
const PATCH_SECTION_VERSION: u16 = 1;

#[tauri::command]
pub fn patch_load_current_show(
    state: State<'_, ShowRuntimeState>,
) -> Result<Option<PatchDocument>, String> {
    let Some(_show) = state.current()? else {
        return Ok(None);
    };

    Ok(Some(load_patch_document(&state)?))
}

#[tauri::command]
pub fn patch_save_current_show(
    fixtures: serde_json::Value,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<(), String> {
    let Some(_show) = state.current()? else {
        return Err("No show file loaded. Create or load a show before editing patch.".to_string());
    };

    let fixtures = serde_json::from_value(fixtures).map_err(|error| error.to_string())?;
    let document = normalize_document(PatchDocument { fixtures });
    validate_fixtures(&document.fixtures).map_err(|error| error.to_string())?;
    let saved_show = save_patch_document(&document, &state)?;
    events::emit_patch_changed(&app, &saved_show);
    request_patch_output(&app);
    Ok(())
}

#[tauri::command]
pub fn patch_apply_wizard(
    fixture_type: FixtureTypeRef,
    draft: PatchWizardDraft,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<PatchCommandResult, String> {
    mutate_patch_document(state, selection_state, programmer_state, app, |document| {
        apply_wizard(document, fixture_type, draft)
    })
}

#[tauri::command]
pub fn patch_update_fixture(
    id: String,
    patch: PatchFixturePatch,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<PatchCommandResult, String> {
    mutate_patch_document(state, selection_state, programmer_state, app, |document| {
        update_fixture(document, &id, patch)
    })
}

#[tauri::command]
pub fn patch_delete_fixture(
    id: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<PatchCommandResult, String> {
    mutate_patch_document(state, selection_state, programmer_state, app, |document| {
        delete_fixture(document, &id)
    })
}

#[tauri::command]
pub fn patch_duplicate_fixture(
    id: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<PatchCommandResult, String> {
    mutate_patch_document(state, selection_state, programmer_state, app, |document| {
        duplicate_fixture(document, &id)
    })
}

#[tauri::command]
pub fn patch_auto_patch(
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<PatchCommandResult, String> {
    mutate_patch_document(state, selection_state, programmer_state, app, auto_patch)
}

fn mutate_patch_document(
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    app: AppHandle,
    mutation: impl FnOnce(PatchDocument) -> limxdesk_patch::PatchResult<PatchCommandResult>,
) -> Result<PatchCommandResult, String> {
    let Some(_show) = state.current()? else {
        return Err("No show file loaded. Create or load a show before editing patch.".to_string());
    };

    let document = load_patch_document(&state)?;
    let result = mutation(document).map_err(|error| error.to_string())?;
    let saved_show = save_patch_document(&result.document, &state)?;
    if result.selected_id.is_some() {
        programmer::sync_programmer_selection(
            &programmer_state,
            &selection_state,
            &app,
            result.selected_id.clone(),
        )?;
    }
    events::emit_patch_changed(&app, &saved_show);
    request_patch_output(&app);
    Ok(result)
}

fn request_patch_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request output after patch change: {error}");
    }
}

pub(crate) fn load_patch_document(
    state: &State<'_, ShowRuntimeState>,
) -> Result<PatchDocument, String> {
    let document = state
        .read_section::<PatchDocument>(PATCH_SECTION_KEY)?
        .unwrap_or_default();
    Ok(normalize_document(document))
}

fn save_patch_document(
    document: &PatchDocument,
    state: &State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    state.write_section(PATCH_SECTION_KEY, PATCH_SECTION_VERSION, document)
}
