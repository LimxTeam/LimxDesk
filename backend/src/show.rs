use crate::{
    events, fixture_selection::FixtureSelectionState, output, programmer::ProgrammerState,
    engine::EngineState,
};
use limxdesk_platform::current_timestamp_millis;
use limxdesk_showfile::{
    LoadedShow, LoadedShowDocument, ShowFileEntry, ShowRepository, ShowSection,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct ShowRuntimeState {
    current: Mutex<Option<RuntimeShowDocument>>,
}

#[derive(Clone)]
struct RuntimeShowDocument {
    loaded: LoadedShow,
    sections: Vec<ShowSection>,
    dirty: bool,
}

impl ShowRuntimeState {
    pub(crate) fn current(&self) -> Result<Option<LoadedShow>, String> {
        {
            let current = self
                .current
                .lock()
                .map_err(|_| "show runtime state lock poisoned".to_string())?;
            if let Some(current) = current.as_ref() {
                return Ok(Some(current.loaded.clone()));
            }
        }

        let Some(loaded) = ShowRepository::default_for_current_os()
            .load_active()
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };

        self.set_current(loaded.clone())?;
        Ok(Some(loaded))
    }

    pub(crate) fn set_current(&self, loaded: LoadedShow) -> Result<(), String> {
        let repository = ShowRepository::default_for_current_os();
        repository
            .activate(&loaded)
            .map_err(|error| error.to_string())?;
        let document = repository
            .load_document(&loaded.path)
            .map_err(|error| error.to_string())?;

        self.set_current_document(document, false)
    }

    pub(crate) fn set_current_document(
        &self,
        document: LoadedShowDocument,
        dirty: bool,
    ) -> Result<(), String> {
        ShowRepository::default_for_current_os()
            .activate(&document.loaded)
            .map_err(|error| error.to_string())?;

        let mut current = self
            .current
            .lock()
            .map_err(|_| "show runtime state lock poisoned".to_string())?;
        *current = Some(RuntimeShowDocument {
            loaded: document.loaded,
            sections: document.sections,
            dirty,
        });
        Ok(())
    }

    pub(crate) fn read_section<T>(&self, key: &str) -> Result<Option<T>, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let _ = self.current()?;
        let current = self
            .current
            .lock()
            .map_err(|_| "show runtime state lock poisoned".to_string())?;
        let Some(current) = current.as_ref() else {
            return Ok(None);
        };
        let Some(section) = current.sections.iter().find(|section| section.key == key) else {
            return Ok(None);
        };
        serde_json::from_slice(&section.payload)
            .map(Some)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn write_section<T>(
        &self,
        key: impl Into<String>,
        version: u16,
        value: &T,
    ) -> Result<LoadedShow, String>
    where
        T: Serialize,
    {
        let Some(_) = self.current()? else {
            return Err(
                "No show file loaded. Create or load a show before editing show data.".to_string(),
            );
        };

        let key = key.into();
        let payload = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        let mut current = self
            .current
            .lock()
            .map_err(|_| "show runtime state lock poisoned".to_string())?;
        let Some(current) = current.as_mut() else {
            return Err(
                "No show file loaded. Create or load a show before editing show data.".to_string(),
            );
        };

        if let Some(section) = current
            .sections
            .iter_mut()
            .find(|section| section.key == key)
        {
            section.version = version;
            section.payload = payload;
        } else {
            current.sections.push(ShowSection {
                key,
                version,
                payload,
            });
        }

        current.loaded.manifest.modified_at_ms =
            current_timestamp_millis().map_err(|error| error.to_string())?;
        current.dirty = true;
        Ok(current.loaded.clone())
    }

    pub(crate) fn flush_current(&self) -> Result<Option<LoadedShow>, String> {
        let document = {
            let current = self
                .current
                .lock()
                .map_err(|_| "show runtime state lock poisoned".to_string())?;
            let Some(current) = current.as_ref() else {
                return Ok(None);
            };
            if !current.dirty {
                return Ok(Some(current.loaded.clone()));
            }
            LoadedShowDocument {
                loaded: current.loaded.clone(),
                sections: current.sections.clone(),
            }
        };

        let saved = ShowRepository::default_for_current_os()
            .save_document(&document.loaded.path, document.sections)
            .map_err(|error| error.to_string())?;
        self.set_current_document(saved.clone(), false)?;
        Ok(Some(saved.loaded))
    }

    pub(crate) fn save_current_as(&self, name: String) -> Result<LoadedShow, String> {
        let document = {
            let Some(_) = self.current()? else {
                return Err("No show file loaded. Create or load a show before saving.".to_string());
            };
            let current = self
                .current
                .lock()
                .map_err(|_| "show runtime state lock poisoned".to_string())?;
            let Some(current) = current.as_ref() else {
                return Err("No show file loaded. Create or load a show before saving.".to_string());
            };
            LoadedShowDocument {
                loaded: current.loaded.clone(),
                sections: current.sections.clone(),
            }
        };

        let saved = ShowRepository::default_for_current_os()
            .save_document_as(&document.loaded.path, name, document.sections)
            .map_err(|error| error.to_string())?;
        self.set_current_document(saved.clone(), false)?;
        Ok(saved.loaded)
    }

    fn clear_current(&self) -> Result<(), String> {
        ShowRepository::default_for_current_os()
            .clear_active()
            .map_err(|error| error.to_string())?;

        let mut current = self
            .current
            .lock()
            .map_err(|_| "show runtime state lock poisoned".to_string())?;
        *current = None;
        Ok(())
    }
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
pub fn show_create(
    name: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .create(name)
        .map_err(|error| error.to_string())?;
    state.set_current(loaded.clone())?;
    reset_runtime_context(&state, &selection_state, &programmer_state, &engine_state, &app)?;
    events::emit_show_loaded(&app, &loaded);
    request_default_output(&app);
    Ok(loaded)
}

#[tauri::command]
pub fn show_load(
    path: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .load(path)
        .map_err(|error| error.to_string())?;
    state.set_current(loaded.clone())?;
    reset_runtime_context(&state, &selection_state, &programmer_state, &engine_state, &app)?;
    events::emit_show_loaded(&app, &loaded);
    request_default_output(&app);
    Ok(loaded)
}

#[tauri::command]
pub fn show_save(
    path: String,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<LoadedShow, String> {
    let Some(current) = state.current()? else {
        return Err("No show file loaded. Create or load a show before saving.".to_string());
    };
    if current.path != path {
        return Err(
            "Saving an inactive show path is not supported by the runtime cache.".to_string(),
        );
    }
    let loaded = state
        .flush_current()?
        .ok_or_else(|| "No show file loaded. Create or load a show before saving.".to_string())?;
    events::emit_show_saved(&app, &loaded);
    Ok(loaded)
}

#[tauri::command]
pub fn show_save_as(
    source_path: String,
    name: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<LoadedShow, String> {
    let Some(current) = state.current()? else {
        return Err("No show file loaded. Create or load a show before saving.".to_string());
    };
    if current.path != source_path {
        return Err(
            "Saving an inactive show path is not supported by the runtime cache.".to_string(),
        );
    }
    let loaded = state.save_current_as(name)?;
    reset_runtime_context(&state, &selection_state, &programmer_state, &engine_state, &app)?;
    events::emit_show_loaded(&app, &loaded);
    request_default_output(&app);
    Ok(loaded)
}

#[tauri::command]
pub fn show_delete(
    path: String,
    state: State<'_, ShowRuntimeState>,
    selection_state: State<'_, FixtureSelectionState>,
    programmer_state: State<'_, ProgrammerState>,
    engine_state: State<'_, EngineState>,
    app: AppHandle,
) -> Result<(), String> {
    ShowRepository::default_for_current_os()
        .delete(&path)
        .map_err(|error| error.to_string())?;

    if state.current()?.is_some_and(|show| show.path == path) {
        state.clear_current()?;
        reset_runtime_context(&state, &selection_state, &programmer_state, &engine_state, &app)?;
    }

    events::emit_show_deleted(&app, path);
    Ok(())
}

#[tauri::command]
pub fn show_current(state: State<'_, ShowRuntimeState>) -> Result<Option<LoadedShow>, String> {
    state.current()
}

fn reset_runtime_context(
    show_state: &State<'_, ShowRuntimeState>,
    selection_state: &State<'_, FixtureSelectionState>,
    programmer_state: &State<'_, ProgrammerState>,
    engine_state: &State<'_, EngineState>,
    app: &AppHandle,
) -> Result<(), String> {
    let selection = selection_state.current()?;
    let cleared_selection = selection.clear();
    let cleared_selection = selection_state.set_current(cleared_selection)?;
    events::emit_fixture_selection_changed(app, &cleared_selection);

    let programmer = programmer_state.set_current(limxdesk_programmer::Programmer::default())?;
    events::emit_programmer_changed(app, &programmer);

    // 换 show 时丢掉全部回放状态，随即把新 show 的内容装上。
    //
    // 这里主动装载而不是等前端调 load 命令：否则引擎在两次调用之间是空的，
    // 输出会短暂断掉，而且正确性取决于前端的调用顺序。
    let sequences = crate::sequence::load_sequence_document(show_state)?;
    let playback = crate::playback::load_playback_document(show_state)?;
    engine_state.reload_all(&sequences, &playback)?;
    events::emit_sequence_state_changed(app, &engine_state.snapshot()?);
    Ok(())
}

fn request_default_output(app: &AppHandle) {
    if let Err(error) = output::request_output_send(app) {
        tracing::warn!("failed to request default output after show change: {error}");
    }
}
