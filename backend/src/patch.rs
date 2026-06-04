use crate::show::ShowRuntimeState;
use limxdesk_showfile::ShowRepository;
use serde::{Deserialize, Serialize};
use tauri::State;

const PATCH_SECTION_KEY: &str = "patch.v1";
const PATCH_SECTION_VERSION: u16 = 1;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchDocument {
    pub fixtures: serde_json::Value,
}

#[tauri::command]
pub fn patch_load_current_show(
    state: State<'_, ShowRuntimeState>,
) -> Result<Option<PatchDocument>, String> {
    let Some(show) = state.current()? else {
        return Ok(None);
    };

    let document = ShowRepository::default_for_current_os()
        .read_section::<PatchDocument>(&show.path, PATCH_SECTION_KEY)
        .map_err(|error| error.to_string())?;

    Ok(document.or_else(|| {
        Some(PatchDocument {
            fixtures: serde_json::Value::Array(Vec::new()),
        })
    }))
}

#[tauri::command]
pub fn patch_save_current_show(
    fixtures: serde_json::Value,
    state: State<'_, ShowRuntimeState>,
) -> Result<(), String> {
    let Some(show) = state.current()? else {
        return Err("No show file loaded. Create or load a show before editing patch.".to_string());
    };

    let document = PatchDocument { fixtures };
    let loaded = ShowRepository::default_for_current_os()
        .write_section(
            &show.path,
            PATCH_SECTION_KEY,
            PATCH_SECTION_VERSION,
            &document,
        )
        .map_err(|error| error.to_string())?;

    state.set_current(loaded)?;
    Ok(())
}
