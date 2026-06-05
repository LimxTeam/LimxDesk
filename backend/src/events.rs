use limxdesk_showfile::LoadedShow;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const SHOW_LOADED: &str = "show:loaded";
pub const SHOW_SAVED: &str = "show:saved";
pub const SHOW_DELETED: &str = "show:deleted";
pub const SHOW_CHANGED: &str = "show:changed";
pub const FIXTURE_TYPES_CHANGED: &str = "fixture-types:changed";
pub const PATCH_CHANGED: &str = "patch:changed";
pub const LAYOUT_CHANGED: &str = "layout:changed";
pub const FIXTURE_SELECTION_CHANGED: &str = "fixture-selection:changed";
pub const PROGRAMMER_CHANGED: &str = "programmer:changed";
pub const OUTPUT_CHANGED: &str = "output:changed";
pub const OUTPUT_SENT: &str = "output:sent";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowEventPayload {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEventPayload {
    pub path: String,
}

pub fn emit_show_loaded(app: &AppHandle, show: &LoadedShow) {
    emit_show(app, SHOW_LOADED, show);
    emit_show(app, SHOW_CHANGED, show);
}

pub fn emit_show_saved(app: &AppHandle, show: &LoadedShow) {
    emit_show(app, SHOW_SAVED, show);
    emit_show(app, SHOW_CHANGED, show);
}

pub fn emit_show_deleted(app: &AppHandle, path: String) {
    let _ = app.emit(SHOW_DELETED, PathEventPayload { path });
    let _ = app.emit(SHOW_CHANGED, ());
}

pub fn emit_fixture_types_changed(app: &AppHandle, show: &LoadedShow) {
    emit_show(app, FIXTURE_TYPES_CHANGED, show);
    emit_show(app, SHOW_CHANGED, show);
}

pub fn emit_patch_changed(app: &AppHandle, show: &LoadedShow) {
    emit_show(app, PATCH_CHANGED, show);
    emit_show(app, SHOW_CHANGED, show);
}

pub fn emit_layout_changed(app: &AppHandle, show: &LoadedShow) {
    emit_show(app, LAYOUT_CHANGED, show);
    emit_show(app, SHOW_CHANGED, show);
}

pub fn emit_output_changed(app: &AppHandle, show: Option<&LoadedShow>) {
    if let Some(show) = show {
        emit_show(app, OUTPUT_CHANGED, show);
        emit_show(app, SHOW_CHANGED, show);
    } else {
        let _ = app.emit(OUTPUT_CHANGED, ());
    }
}

pub fn emit_output_sent<T>(app: &AppHandle, report: &T)
where
    T: Serialize + Clone,
{
    let _ = app.emit(OUTPUT_SENT, report.clone());
}

pub fn emit_fixture_selection_changed<T>(app: &AppHandle, selection: &T)
where
    T: Serialize + Clone,
{
    let _ = app.emit(FIXTURE_SELECTION_CHANGED, selection.clone());
}

pub fn emit_programmer_changed<T>(app: &AppHandle, programmer: &T)
where
    T: Serialize + Clone,
{
    let _ = app.emit(PROGRAMMER_CHANGED, programmer.clone());
}

fn emit_show(app: &AppHandle, event: &str, show: &LoadedShow) {
    let _ = app.emit(
        event,
        ShowEventPayload {
            id: show.manifest.id.to_string(),
            name: show.manifest.name.clone(),
            path: show.path.clone(),
        },
    );
}
