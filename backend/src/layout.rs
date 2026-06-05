use crate::{events, show::ShowRuntimeState};
use limxdesk_showfile::{LoadedShow, ShowRepository};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

const LAYOUT_SECTION_KEY: &str = "layout.v1";
const LAYOUT_SECTION_VERSION: u16 = 1;
const VIEW_SLOT_COUNT: u8 = 18;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDocument {
    #[serde(default)]
    pub windows: Vec<LayoutWindow>,
    #[serde(default)]
    pub view_slots: Vec<LayoutViewSlot>,
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
    #[serde(default)]
    pub config: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutViewSlot {
    pub id: u8,
    #[serde(default)]
    pub appearance: NamedAppearance,
    #[serde(default)]
    pub windows: Vec<LayoutWindow>,
    #[serde(default)]
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedAppearance {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_background_color")]
    pub background_color: String,
    #[serde(default = "default_text_color")]
    pub text_color: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    #[serde(default)]
    pub scribble: Option<NamedScribble>,
    #[serde(default)]
    pub image: Option<NamedImage>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedScribble {
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default = "default_scribble_color")]
    pub color: String,
    #[serde(default = "default_scribble_opacity")]
    pub opacity: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedImage {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub data_url: String,
    #[serde(default = "default_image_fit")]
    pub fit: String,
    #[serde(default = "default_image_opacity")]
    pub opacity: f32,
    #[serde(default = "default_image_scale")]
    pub scale: f32,
    #[serde(default)]
    pub offset_x: f32,
    #[serde(default)]
    pub offset_y: f32,
    #[serde(default)]
    pub rotation: f32,
}

impl Default for NamedAppearance {
    fn default() -> Self {
        Self {
            name: String::new(),
            background_color: default_background_color(),
            text_color: default_text_color(),
            accent_color: default_accent_color(),
            scribble: None,
            image: None,
        }
    }
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

    let mut document = load_layout_document(&show)?;
    document.windows = windows.into_iter().map(normalize_window).collect();
    let saved_show = save_layout_document(&show, &document, &state)?;
    events::emit_layout_changed(&app, &saved_show);
    Ok(document)
}

#[tauri::command]
pub fn layout_save_view_slot(
    slot: LayoutViewSlot,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<LayoutDocument, String> {
    let Some(show) = state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before saving view slots.".to_string(),
        );
    };

    let mut document = load_layout_document(&show)?;
    let normalized = normalize_view_slot(slot);
    document.view_slots.retain(|item| item.id != normalized.id);
    document.view_slots.push(normalized);

    let document = normalize_document(document);
    let saved_show = save_layout_document(&show, &document, &state)?;
    events::emit_layout_changed(&app, &saved_show);
    Ok(document)
}

#[tauri::command]
pub fn layout_clear_view_slot(
    slot_id: u8,
    state: State<'_, ShowRuntimeState>,
    app: AppHandle,
) -> Result<LayoutDocument, String> {
    let Some(show) = state.current()? else {
        return Err(
            "No show file loaded. Create or load a show before clearing view slots.".to_string(),
        );
    };

    let mut document = load_layout_document(&show)?;
    let normalized_id = normalize_slot_id(slot_id);
    document.view_slots.retain(|item| item.id != normalized_id);

    let document = normalize_document(document);
    let saved_show = save_layout_document(&show, &document, &state)?;
    events::emit_layout_changed(&app, &saved_show);
    Ok(document)
}

fn load_layout_document(show: &LoadedShow) -> Result<LayoutDocument, String> {
    let document = ShowRepository::default_for_current_os()
        .read_section::<LayoutDocument>(&show.path, LAYOUT_SECTION_KEY)
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    Ok(normalize_document(document))
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

fn normalize_document(document: LayoutDocument) -> LayoutDocument {
    let mut view_slots = document
        .view_slots
        .into_iter()
        .map(normalize_view_slot)
        .collect::<Vec<_>>();
    view_slots.sort_by_key(|slot| slot.id);
    view_slots.dedup_by_key(|slot| slot.id);

    LayoutDocument {
        windows: document.windows.into_iter().map(normalize_window).collect(),
        view_slots,
    }
}

fn normalize_view_slot(mut slot: LayoutViewSlot) -> LayoutViewSlot {
    slot.id = normalize_slot_id(slot.id);
    slot.appearance = normalize_appearance(slot.appearance, slot.id);
    slot.windows = slot.windows.into_iter().map(normalize_window).collect();
    if slot.updated_at_ms == 0 {
        slot.updated_at_ms = unix_time_ms();
    }
    slot
}

fn normalize_slot_id(id: u8) -> u8 {
    id.clamp(1, VIEW_SLOT_COUNT)
}

fn normalize_appearance(mut appearance: NamedAppearance, slot_id: u8) -> NamedAppearance {
    appearance.name = appearance.name.trim().to_string();
    if appearance.name.is_empty() {
        appearance.name = format!("View {}", slot_id);
    }
    if appearance.background_color.trim().is_empty() {
        appearance.background_color = default_background_color();
    }
    if appearance.text_color.trim().is_empty() {
        appearance.text_color = default_text_color();
    }
    if appearance.accent_color.trim().is_empty() {
        appearance.accent_color = default_accent_color();
    }
    if let Some(scribble) = appearance.scribble.as_mut() {
        scribble.paths.retain(|path| !path.trim().is_empty());
        if scribble.paths.is_empty() {
            appearance.scribble = None;
        }
    }
    if let Some(image) = appearance.image.as_mut() {
        image.data_url = image.data_url.trim().to_string();
        if image.data_url.is_empty() {
            appearance.image = None;
        } else {
            image.opacity = image.opacity.clamp(0.05, 1.0);
            image.scale = image.scale.clamp(0.2, 3.0);
            image.offset_x = image.offset_x.clamp(-100.0, 100.0);
            image.offset_y = image.offset_y.clamp(-100.0, 100.0);
            image.rotation = image.rotation.clamp(-180.0, 180.0);
            if image.fit != "contain" {
                image.fit = default_image_fit();
            }
        }
    }
    appearance
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn default_background_color() -> String {
    "#1D2430".to_string()
}

fn default_text_color() -> String {
    "#F4F7FB".to_string()
}

fn default_accent_color() -> String {
    "#4DA3F5".to_string()
}

fn default_scribble_color() -> String {
    "#F5B84D".to_string()
}

fn default_scribble_opacity() -> f32 {
    0.9
}

fn default_image_fit() -> String {
    "cover".to_string()
}

fn default_image_opacity() -> f32 {
    0.55
}

fn default_image_scale() -> f32 {
    1.0
}
