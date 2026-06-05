use crate::{events, output, show::ShowRuntimeState};
use limxdesk_fixture_types::{
    FixtureTypeDraft, FixtureTypeEntry, FixtureTypeRepository, FixtureTypeSource,
};
use limxdesk_platform::current_timestamp_millis;
use limxdesk_showfile::LoadedShow;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::Path};
use tauri::{AppHandle, State};

const FIXTURE_TYPES_SECTION_KEY: &str = "fixture-types.v1";
const FIXTURE_TYPES_SECTION_VERSION: u16 = 1;
const PATCH_SECTION_KEY: &str = "patch.v1";
const PATCH_SECTION_VERSION: u16 = 1;

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

#[tauri::command]
pub fn fixture_type_scan_current_show(
    state: State<'_, ShowRuntimeState>,
) -> Result<Vec<FixtureTypeEntry>, String> {
    let (show, mut document) = load_show_fixture_type_document(&state)?;
    let _show = migrate_global_fixture_types_into_show(&show, &mut document, &state)?;
    let used_counts = load_fixture_type_usage(&state)?;
    let mut entries = entries_from_document(&document)?;

    for entry in &mut entries {
        entry.used = *used_counts
            .get(&entry.path)
            .or_else(|| used_counts.get(&entry.id))
            .unwrap_or(&0);
    }

    entries.sort_by(|left, right| {
        left.manufacturer
            .cmp(&right.manufacturer)
            .then(left.name.cmp(&right.name))
    });
    Ok(entries)
}

#[tauri::command]
pub fn fixture_type_import_gdtf_to_show(
    path: String,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<FixtureTypeEntry, String> {
    let (_show, mut document) = load_show_fixture_type_document(&state)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let entry = entry_from_show_bytes(&bytes, "", 0)?;
    let now = current_timestamp_millis().map_err(|error| error.to_string())?;
    let record = ShowFixtureTypeRecord {
        id: entry.id.clone(),
        path: show_fixture_type_path(&entry.id),
        origin_path: path,
        gdtf_bytes: bytes,
        created_at_ms: now,
        updated_at_ms: now,
    };

    upsert_show_fixture_type(&mut document, record);
    let saved_show = save_show_fixture_type_document(&document, &state)?;
    events::emit_fixture_types_changed(&app, &saved_show);
    request_fixture_type_output(&app);
    let entries = entries_from_document(&document)?;
    entries
        .into_iter()
        .find(|item| item.id == entry.id)
        .ok_or_else(|| "imported fixture type was not found in show".to_string())
}

#[tauri::command]
pub fn fixture_type_create_in_show(
    draft: FixtureTypeDraft,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<FixtureTypeEntry, String> {
    let (_show, mut document) = load_show_fixture_type_document(&state)?;
    let bytes =
        FixtureTypeRepository::create_gdtf_bytes(draft).map_err(|error| error.to_string())?;
    let entry = entry_from_show_bytes(&bytes, "", 0)?;
    let now = current_timestamp_millis().map_err(|error| error.to_string())?;

    upsert_show_fixture_type(
        &mut document,
        ShowFixtureTypeRecord {
            id: entry.id.clone(),
            path: show_fixture_type_path(&entry.id),
            origin_path: "show://created".to_string(),
            gdtf_bytes: bytes,
            created_at_ms: now,
            updated_at_ms: now,
        },
    );
    let saved_show = save_show_fixture_type_document(&document, &state)?;
    events::emit_fixture_types_changed(&app, &saved_show);
    request_fixture_type_output(&app);
    let entries = entries_from_document(&document)?;
    entries
        .into_iter()
        .find(|item| item.id == entry.id)
        .ok_or_else(|| "created fixture type was not found in show".to_string())
}

#[tauri::command]
pub fn fixture_type_update_in_show(
    path: String,
    draft: FixtureTypeDraft,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<FixtureTypeEntry, String> {
    let (_show, mut document) = load_show_fixture_type_document(&state)?;
    let Some(record) = document.entries.iter_mut().find(|item| item.path == path) else {
        return Err(format!(
            "fixture type is not imported into current show: {path}"
        ));
    };

    record.gdtf_bytes = FixtureTypeRepository::update_gdtf_bytes(&record.gdtf_bytes, draft)
        .map_err(|error| error.to_string())?;
    record.updated_at_ms = current_timestamp_millis().map_err(|error| error.to_string())?;
    let updated_path = record.path.clone();

    let saved_show = save_show_fixture_type_document(&document, &state)?;
    events::emit_fixture_types_changed(&app, &saved_show);
    request_fixture_type_output(&app);
    let entries = entries_from_document(&document)?;
    entries
        .into_iter()
        .find(|item| item.path == updated_path)
        .ok_or_else(|| "updated fixture type was not found in show".to_string())
}

#[tauri::command]
pub fn fixture_type_delete_from_show(
    path: String,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<(), String> {
    let (_show, mut document) = load_show_fixture_type_document(&state)?;
    let used_counts = load_fixture_type_usage(&state)?;
    if used_counts.get(&path).copied().unwrap_or(0) > 0 {
        return Err("fixture type is used by patch and cannot be deleted".to_string());
    }

    let initial_len = document.entries.len();
    document.entries.retain(|item| item.path != path);
    if document.entries.len() == initial_len {
        return Err(format!(
            "fixture type is not imported into current show: {path}"
        ));
    }

    let saved_show = save_show_fixture_type_document(&document, &state)?;
    events::emit_fixture_types_changed(&app, &saved_show);
    request_fixture_type_output(&app);
    Ok(())
}

fn request_fixture_type_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request output after fixture type change: {error}");
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowFixtureTypeDocument {
    entries: Vec<ShowFixtureTypeRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShowFixtureTypeRecord {
    id: String,
    path: String,
    origin_path: String,
    gdtf_bytes: Vec<u8>,
    created_at_ms: u64,
    updated_at_ms: u64,
}

fn load_show_fixture_type_document(
    state: &State<'_, ShowRuntimeState>,
) -> Result<(LoadedShow, ShowFixtureTypeDocument), String> {
    let Some(show) = state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing fixture types.".to_string(),
        );
    };

    let document = state
        .read_section::<ShowFixtureTypeDocument>(FIXTURE_TYPES_SECTION_KEY)?
        .unwrap_or_default();

    Ok((show, document))
}

fn save_show_fixture_type_document(
    document: &ShowFixtureTypeDocument,
    state: &State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    state.write_section(
        FIXTURE_TYPES_SECTION_KEY,
        FIXTURE_TYPES_SECTION_VERSION,
        document,
    )
}

fn entries_from_document(
    document: &ShowFixtureTypeDocument,
) -> Result<Vec<FixtureTypeEntry>, String> {
    document
        .entries
        .iter()
        .map(|record| {
            let mut entry =
                entry_from_show_bytes(&record.gdtf_bytes, &record.path, record.gdtf_bytes.len())?;
            entry.id = record.id.clone();
            Ok(entry)
        })
        .collect()
}

fn migrate_global_fixture_types_into_show(
    show: &LoadedShow,
    document: &mut ShowFixtureTypeDocument,
    state: &State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    let Some(mut patch_document) =
        state.read_section::<limxdesk_patch::PatchDocument>(PATCH_SECTION_KEY)?
    else {
        return Ok(show.clone());
    };

    let mut migrated = false;
    let mut saved_show = show.clone();
    for fixture in &mut patch_document.fixtures {
        if fixture.fixture_type_path.trim().is_empty()
            || fixture.fixture_type_path.starts_with("show://")
            || document.entries.iter().any(|record| {
                record.path == fixture.fixture_type_path || record.id == fixture.fixture_type_id
            })
        {
            continue;
        }

        let source_path = Path::new(&fixture.fixture_type_path);
        if !source_path.exists() {
            continue;
        }

        let bytes = fs::read(source_path).map_err(|error| error.to_string())?;
        let entry = entry_from_show_bytes(&bytes, "", 0)?;
        let now = current_timestamp_millis().map_err(|error| error.to_string())?;
        let show_path = show_fixture_type_path(&entry.id);
        upsert_show_fixture_type(
            document,
            ShowFixtureTypeRecord {
                id: entry.id.clone(),
                path: show_path.clone(),
                origin_path: fixture.fixture_type_path.clone(),
                gdtf_bytes: bytes,
                created_at_ms: now,
                updated_at_ms: now,
            },
        );

        fixture.fixture_type_id = entry.id;
        fixture.fixture_type_name = format!("{} {}", entry.manufacturer, entry.name)
            .trim()
            .to_string();
        fixture.fixture_type_path = show_path;
        migrated = true;
    }

    if migrated {
        save_show_fixture_type_document(document, state)?;
        saved_show = state.write_section(
            PATCH_SECTION_KEY,
            PATCH_SECTION_VERSION,
            &limxdesk_patch::normalize_document(patch_document),
        )?;
    }

    Ok(saved_show)
}

fn entry_from_show_bytes(
    bytes: &[u8],
    path: &str,
    size_bytes: usize,
) -> Result<FixtureTypeEntry, String> {
    let entry_path = if path.is_empty() {
        "show://fixture-types/pending.gdtf"
    } else {
        path
    };
    let mut entry =
        FixtureTypeRepository::entry_from_gdtf_bytes(bytes, entry_path, FixtureTypeSource::Show)
            .map_err(|error| error.to_string())?;
    if size_bytes > 0 {
        entry.size_bytes = size_bytes as u64;
    }
    Ok(entry)
}

fn upsert_show_fixture_type(document: &mut ShowFixtureTypeDocument, record: ShowFixtureTypeRecord) {
    if let Some(existing) = document
        .entries
        .iter_mut()
        .find(|item| item.id == record.id)
    {
        *existing = ShowFixtureTypeRecord {
            created_at_ms: existing.created_at_ms,
            ..record
        };
    } else {
        document.entries.push(record);
    }
}

fn show_fixture_type_path(id: &str) -> String {
    format!("show://fixture-types/{id}.gdtf")
}

fn load_fixture_type_usage(
    state: &State<'_, ShowRuntimeState>,
) -> Result<HashMap<String, u16>, String> {
    let Some(document) = state.read_section::<serde_json::Value>(PATCH_SECTION_KEY)? else {
        return Ok(HashMap::new());
    };

    let mut counts = HashMap::new();
    let fixtures = document
        .get("fixtures")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();

    for fixture in fixtures {
        if let Some(path) = fixture
            .get("fixtureTypePath")
            .and_then(serde_json::Value::as_str)
        {
            *counts.entry(path.to_string()).or_insert(0) += 1;
        }
        if let Some(id) = fixture
            .get("fixtureTypeId")
            .and_then(serde_json::Value::as_str)
        {
            *counts.entry(id.to_string()).or_insert(0) += 1;
        }
    }

    Ok(counts)
}
