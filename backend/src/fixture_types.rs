use limxdesk_fixture_types::{FixtureTypeDraft, FixtureTypeEntry, FixtureTypeRepository};

#[tauri::command]
pub fn fixture_type_library_root() -> Result<String, String> {
    let repository = FixtureTypeRepository::default_for_current_os();
    repository
        .ensure_library()
        .map_err(|error| error.to_string())?;
    Ok(repository.gdtf_root().to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn fixture_type_scan_library() -> Result<Vec<FixtureTypeEntry>, String> {
    FixtureTypeRepository::default_for_current_os()
        .list()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fixture_type_import_gdtf(path: String) -> Result<FixtureTypeEntry, String> {
    FixtureTypeRepository::default_for_current_os()
        .import_gdtf(path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fixture_type_create(draft: FixtureTypeDraft) -> Result<FixtureTypeEntry, String> {
    FixtureTypeRepository::default_for_current_os()
        .create(draft)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fixture_type_update(
    path: String,
    draft: FixtureTypeDraft,
) -> Result<FixtureTypeEntry, String> {
    FixtureTypeRepository::default_for_current_os()
        .update(path, draft)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn fixture_type_delete(path: String) -> Result<(), String> {
    FixtureTypeRepository::default_for_current_os()
        .delete(path)
        .map_err(|error| error.to_string())
}
