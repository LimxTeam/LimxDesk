use limxdesk_showfile::{LoadedShow, ShowFileEntry, ShowRepository};
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct ShowRuntimeState {
    current: Mutex<Option<LoadedShow>>,
}

#[tauri::command]
pub fn show_library_root() -> Result<String, String> {
    let repository = ShowRepository::default_for_current_os();
    repository
        .ensure_library()
        .map_err(|error| error.to_string())?;

    Ok(repository.show_root().to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn show_scan_library() -> Result<Vec<ShowFileEntry>, String> {
    ShowRepository::default_for_current_os()
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_create(name: String, state: State<'_, ShowRuntimeState>) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .create(name)
        .map_err(|error| error.to_string())?;
    set_current_show(&state, loaded.clone())?;
    Ok(loaded)
}

#[tauri::command]
pub fn show_load(path: String, state: State<'_, ShowRuntimeState>) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .load(path)
        .map_err(|error| error.to_string())?;
    set_current_show(&state, loaded.clone())?;
    Ok(loaded)
}

#[tauri::command]
pub fn show_save(path: String, state: State<'_, ShowRuntimeState>) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .save(path)
        .map_err(|error| error.to_string())?;
    set_current_show(&state, loaded.clone())?;
    Ok(loaded)
}

#[tauri::command]
pub fn show_save_as(
    source_path: String,
    name: String,
    state: State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .save_as(source_path, name)
        .map_err(|error| error.to_string())?;
    set_current_show(&state, loaded.clone())?;
    Ok(loaded)
}

#[tauri::command]
pub fn show_delete(path: String, state: State<'_, ShowRuntimeState>) -> Result<(), String> {
    ShowRepository::default_for_current_os()
        .delete(&path)
        .map_err(|error| error.to_string())?;

    let mut current = state
        .current
        .lock()
        .map_err(|_| "show runtime state lock poisoned".to_string())?;

    if current.as_ref().is_some_and(|show| show.path == path) {
        *current = None;
    }

    Ok(())
}

#[tauri::command]
pub fn show_current(state: State<'_, ShowRuntimeState>) -> Result<Option<LoadedShow>, String> {
    let current = state
        .current
        .lock()
        .map_err(|_| "show runtime state lock poisoned".to_string())?;
    Ok(current.clone())
}

fn set_current_show(state: &State<'_, ShowRuntimeState>, loaded: LoadedShow) -> Result<(), String> {
    let mut current = state
        .current
        .lock()
        .map_err(|_| "show runtime state lock poisoned".to_string())?;
    *current = Some(loaded);
    Ok(())
}
