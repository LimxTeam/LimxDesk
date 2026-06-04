use crate::{events, show::ShowRuntimeState};
use limxdesk_showfile::{LoadedShow, ShowRepository};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

const LAYOUT_SECTION_KEY: &str = "layout.v1";
const LAYOUT_SECTION_VERSION: u16 = 1;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDocument {
    pub windows: Vec<LayoutWindow>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutWindow {
    pub id: String,
    pub window_type: String,
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
}

#[tauri::command]
pub fn layout_load_current_show(
    state: State<'_, ShowRuntimeState>,
) -> Result<Option<LayoutDocument>, String> {
    let Some(show) = state.current()? else {
        return Ok(None);
    };

    Ok(Some(load_layout_document(&show)?))
}

#[tauri::command]
pub fn layout_save_current_show(
    windows: Vec<LayoutWindow>,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<LayoutDocument, String> {
    let Some(show) = state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before editing layout.".to_string(),
        );
    };

    let document = LayoutDocument {
        windows: windows.into_iter().map(normalize_window).collect(),
    };
    let saved_show = save_layout_document(&show, &document, &state)?;
    events::emit_layout_changed(&app, &saved_show);
    Ok(document)
}

fn load_layout_document(show: &LoadedShow) -> Result<LayoutDocument, String> {
    let document = ShowRepository::default_for_current_os()
        .read_section::<LayoutDocument>(&show.path, LAYOUT_SECTION_KEY)
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(LayoutDocument {
        windows: document.windows.into_iter().map(normalize_window).collect(),
    })
}

fn save_layout_document(
    show: &LoadedShow,
    document: &LayoutDocument,
    state: &State<'_, ShowRuntimeState>,
) -> Result<LoadedShow, String> {
    let loaded = ShowRepository::default_for_current_os()
        .write_section(
            &show.path,
            LAYOUT_SECTION_KEY,
            LAYOUT_SECTION_VERSION,
            document,
        )
        .map_err(|error| error.to_string())?;

    state.set_current(loaded.clone())?;
    Ok(loaded)
}

fn normalize_window(mut window: LayoutWindow) -> LayoutWindow {
    window.x = window.x.min(23);
    window.y = window.y.min(13);
    window.w = window.w.clamp(1, 24 - window.x);
    window.h = window.h.clamp(1, 14 - window.y);
    window
}
