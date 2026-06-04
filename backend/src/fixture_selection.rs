use crate::events;
use limxdesk_fixture_selection::{FixtureSelection, FixtureSelectionMode};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct FixtureSelectionState {
    current: Mutex<FixtureSelection>,
}

impl FixtureSelectionState {
    fn current(&self) -> Result<FixtureSelection, String> {
        let selection = self
            .current
            .lock()
            .map_err(|_| "fixture selection state lock poisoned".to_string())?;
        Ok(selection.clone())
    }

    fn set_current(&self, selection: FixtureSelection) -> Result<FixtureSelection, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "fixture selection state lock poisoned".to_string())?;
        *current = selection.clone();
        Ok(selection)
    }
}

#[tauri::command]
pub fn fixture_selection_get(
    state: State<'_, FixtureSelectionState>,
) -> Result<FixtureSelection, String> {
    state.current()
}

#[tauri::command]
pub fn fixture_selection_select(
    fixture_ids: Vec<String>,
    primary_fixture_id: Option<String>,
    mode: FixtureSelectionMode,
    state: State<'_, FixtureSelectionState>,
    app: AppHandle,
) -> Result<FixtureSelection, String> {
    let current = state.current()?;
    let next = current.select(fixture_ids, primary_fixture_id, mode);
    let next = state.set_current(next)?;
    events::emit_fixture_selection_changed(&app, &next);
    Ok(next)
}

#[tauri::command]
pub fn fixture_selection_clear(
    state: State<'_, FixtureSelectionState>,
    app: AppHandle,
) -> Result<FixtureSelection, String> {
    let current = state.current()?;
    let next = state.set_current(current.clear())?;
    events::emit_fixture_selection_changed(&app, &next);
    Ok(next)
}
