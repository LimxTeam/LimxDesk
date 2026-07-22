use crate::{events, fixture_selection::FixtureSelectionState, output, show::ShowRuntimeState};
use limxdesk_fixture_selection::{FixtureSelection, FixtureSelectionMode};
use limxdesk_programmer::{
    Programmer, ProgrammerAdjustAttributeRequest, ProgrammerClearResult, ProgrammerClearTarget,
    ProgrammerMode, ProgrammerSetAttributeRequest, ProgrammerValue, SelectionTool,
    StoreUseSelection,
};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct ProgrammerState {
    current: Mutex<Programmer>,
}

impl ProgrammerState {
    pub(crate) fn current(&self) -> Result<Programmer, String> {
        let programmer = self
            .current
            .lock()
            .map_err(|_| "programmer state lock poisoned".to_string())?;
        Ok(programmer.clone())
    }

    pub(crate) fn set_current(&self, programmer: Programmer) -> Result<Programmer, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "programmer state lock poisoned".to_string())?;
        *current = programmer.clone();
        Ok(programmer)
    }
}

/// 当前选择上已激活的属性。
///
/// 效果的轨道从这里来 —— 你已经调过的属性就是你想让效果驱动的属性。
#[tauri::command]
pub fn programmer_active_attributes(
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
) -> Result<Vec<limxdesk_programmer::ActiveAttribute>, String> {
    let selection = selection_state.current()?;
    Ok(programmer_state.current()?.active_attributes(&selection))
}

#[tauri::command]
pub fn programmer_get(state: State<'_, ProgrammerState>) -> Result<Programmer, String> {
    state.current()
}

#[tauri::command]
pub fn programmer_replace_current(
    programmer: Programmer,
    state: State<'_, ProgrammerState>,
    _show_state: State<'_, ShowRuntimeState>,
    _output_state: State<'_, output::OutputState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output after replace: {error}");
    }
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_set_mode(
    mode: ProgrammerMode,
    state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = state.current()?.set_mode(mode);
    let programmer = state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_set_blind(
    blind: bool,
    state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = state.current()?.set_blind(blind);
    let programmer = state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_sync_selection(
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let selection = selection_state.current()?;
    let programmer = programmer_state.current()?.sync_selection(&selection);
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_apply_selection_tool(
    tool: SelectionTool,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = programmer_state.current()?.apply_selection_tool(tool);
    let effective_selection = programmer.effective_fixture_selection();
    let programmer = programmer_state.set_current(programmer)?;
    let selection = selection_state.set_current(effective_selection)?;
    events::emit_programmer_changed(&app, &programmer);
    events::emit_fixture_selection_changed(&app, &selection);
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_select_part(
    part_id: u16,
    label: Option<String>,
    state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = state
        .current()?
        .select_part(part_id, label)
        .map_err(|error| error.to_string())?;
    let programmer = state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_set_attribute_for_selection(
    request: ProgrammerSetAttributeRequest,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    _show_state: State<'_, ShowRuntimeState>,
    _output_state: State<'_, output::OutputState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let selection = selection_state.current()?;
    let programmer = programmer_state
        .current()?
        .set_attribute_for_selection(&selection, request)
        .map_err(|error| error.to_string())?;
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output: {error}");
    }
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_set_attributes_for_selection(
    requests: Vec<ProgrammerSetAttributeRequest>,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    _show_state: State<'_, ShowRuntimeState>,
    _output_state: State<'_, output::OutputState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let selection = selection_state.current()?;
    let programmer = programmer_state
        .current()?
        .set_attributes_for_selection(&selection, requests)
        .map_err(|error| error.to_string())?;
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output after batch set: {error}");
    }
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_adjust_attribute_for_selection(
    request: ProgrammerAdjustAttributeRequest,
    selection: Option<FixtureSelection>,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    _show_state: State<'_, ShowRuntimeState>,
    _output_state: State<'_, output::OutputState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let selection = match selection {
        Some(selection) => selection,
        None => selection_state.current()?,
    };
    let programmer = programmer_state
        .current()?
        .adjust_attribute_for_selection(&selection, request)
        .map_err(|error| error.to_string())?;
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output: {error}");
    }
    Ok(programmer)
}

#[tauri::command]
pub fn programmer_clear(
    target: ProgrammerClearTarget,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
    app: AppHandle,
) -> Result<ProgrammerClearResult, String> {
    let selection = selection_state.current()?;
    let result = programmer_state
        .current()?
        .clear(target, !selection.fixture_ids.is_empty());
    let programmer = programmer_state.set_current(result.programmer.clone())?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output after clear: {error}");
    }

    if result.clear_selection {
        let cleared_selection = selection.clear();
        let cleared_selection = selection_state.set_current(cleared_selection)?;
        events::emit_fixture_selection_changed(&app, &cleared_selection);
    }

    Ok(result)
}

#[tauri::command]
pub fn programmer_store_values(
    use_selection: StoreUseSelection,
    programmer_state: State<'_, ProgrammerState>,
    selection_state: State<'_, FixtureSelectionState>,
) -> Result<Vec<ProgrammerValue>, String> {
    let selection = selection_state.current()?;
    Ok(programmer_state
        .current()?
        .store_values(use_selection, &selection))
}

#[tauri::command]
pub fn programmer_reset(
    state: State<'_, ProgrammerState>,
    app: AppHandle,
) -> Result<Programmer, String> {
    let programmer = state.set_current(Programmer::default())?;
    events::emit_programmer_changed(&app, &programmer);
    if let Err(error) = output::request_output_send(&app) {
        tracing::warn!("failed to request programmer output after reset: {error}");
    }
    Ok(programmer)
}

pub(crate) fn sync_programmer_selection(
    programmer_state: &State<'_, ProgrammerState>,
    selection_state: &State<'_, FixtureSelectionState>,
    app: &AppHandle,
    selected_id: Option<String>,
) -> Result<(), String> {
    let selection = if let Some(selected_id) = selected_id {
        let current = selection_state.current()?;
        current.select(
            vec![selected_id.clone()],
            Some(selected_id),
            FixtureSelectionMode::Replace,
        )
    } else {
        selection_state.current()?.clear()
    };

    let selection = selection_state.set_current(selection)?;
    let programmer = programmer_state.current()?.sync_selection(&selection);
    let programmer = programmer_state.set_current(programmer)?;
    events::emit_fixture_selection_changed(app, &selection);
    events::emit_programmer_changed(app, &programmer);
    Ok(())
}
