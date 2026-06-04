use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fmt};
use uuid::Uuid;

#[derive(Debug)]
pub enum PatchError {
    InvalidFixtureType(String),
    InvalidFixture(String),
    Conflict(String),
}

impl fmt::Display for PatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidFixtureType(message)
            | Self::InvalidFixture(message)
            | Self::Conflict(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for PatchError {}

pub type PatchResult<T> = Result<T, PatchError>;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchDocument {
    pub fixtures: Vec<PatchFixture>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFixture {
    pub id: String,
    pub fid: u32,
    pub name: String,
    pub fixture_type_id: String,
    pub fixture_type_name: String,
    pub fixture_type_path: String,
    pub mode_id: String,
    pub mode_name: String,
    pub channels: u16,
    pub universe: Option<u16>,
    pub address: Option<u16>,
    pub stage: String,
    pub pan_invert: bool,
    pub tilt_invert: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFixturePatch {
    pub fid: Option<u32>,
    pub name: Option<String>,
    pub fixture_type_id: Option<String>,
    pub fixture_type_name: Option<String>,
    pub fixture_type_path: Option<String>,
    pub mode_id: Option<String>,
    pub mode_name: Option<String>,
    pub channels: Option<u16>,
    pub universe: Option<Option<u16>>,
    pub address: Option<Option<u16>>,
    pub stage: Option<String>,
    pub pan_invert: Option<bool>,
    pub tilt_invert: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchWizardDraft {
    pub fixture_type_path: String,
    pub mode_id: String,
    pub quantity: u16,
    pub first_fid: u32,
    pub name_prefix: String,
    pub channel_id: u32,
    pub universe: u16,
    pub address: u16,
    pub stage: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureTypeRef {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub path: String,
    pub modes: Vec<FixtureModeRef>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureModeRef {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchCommandResult {
    pub document: PatchDocument,
    pub selected_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Copy, Debug)]
struct DmxRange {
    universe: u16,
    start: u16,
    end: u16,
}

pub fn normalize_document(mut document: PatchDocument) -> PatchDocument {
    document.fixtures = document
        .fixtures
        .into_iter()
        .map(normalize_fixture)
        .collect();
    document.fixtures.sort_by_key(|fixture| fixture.fid);
    document
}

pub fn apply_wizard(
    document: PatchDocument,
    fixture_type: FixtureTypeRef,
    draft: PatchWizardDraft,
) -> PatchResult<PatchCommandResult> {
    let mut document = normalize_document(document);
    let draft = normalize_wizard_draft(draft);
    let mode = fixture_type
        .modes
        .iter()
        .find(|mode| mode.id == draft.mode_id)
        .or_else(|| fixture_type.modes.first())
        .ok_or_else(|| {
            PatchError::InvalidFixtureType("fixture type has no DMX modes".to_string())
        })?;

    let mut next_fixtures = Vec::new();
    let mut universe = draft.universe;
    let mut address = draft.address;

    for index in 0..draft.quantity {
        if address.saturating_add(mode.channels).saturating_sub(1) > 512 {
            universe = universe.saturating_add(1);
            address = 1;
        }

        next_fixtures.push(PatchFixture {
            id: format!("fix-{}", Uuid::new_v4()),
            fid: draft.first_fid + u32::from(index),
            name: format!(
                "{} {}",
                default_if_empty(&draft.name_prefix, &fixture_type.name),
                draft.channel_id + u32::from(index)
            ),
            fixture_type_id: fixture_type.id.clone(),
            fixture_type_name: format_fixture_type_name(&fixture_type),
            fixture_type_path: fixture_type.path.clone(),
            mode_id: mode.id.clone(),
            mode_name: mode.name.clone(),
            channels: mode.channels.max(1),
            universe: Some(universe),
            address: Some(address),
            stage: draft.stage.clone(),
            pan_invert: false,
            tilt_invert: false,
        });

        address = address.saturating_add(mode.channels.max(1));
    }

    let mut candidate = document.fixtures.clone();
    candidate.extend(next_fixtures.iter().cloned());
    validate_fixtures(&candidate)?;
    document.fixtures = candidate;
    document.fixtures.sort_by_key(|fixture| fixture.fid);

    Ok(PatchCommandResult {
        document,
        selected_id: next_fixtures.first().map(|fixture| fixture.id.clone()),
        message: format!(
            "Patched {} {} fixture{}",
            next_fixtures.len(),
            fixture_type.name,
            if next_fixtures.len() == 1 { "" } else { "s" }
        ),
    })
}

pub fn update_fixture(
    document: PatchDocument,
    id: &str,
    patch: PatchFixturePatch,
) -> PatchResult<PatchCommandResult> {
    let mut document = normalize_document(document);
    let Some(index) = document
        .fixtures
        .iter()
        .position(|fixture| fixture.id == id)
    else {
        return Err(PatchError::InvalidFixture(format!(
            "fixture not found: {id}"
        )));
    };

    let mut fixture = document.fixtures[index].clone();
    apply_fixture_patch(&mut fixture, patch);
    fixture = normalize_fixture(fixture);

    let mut candidate = document.fixtures.clone();
    candidate[index] = fixture.clone();
    validate_fixtures(&candidate)?;
    candidate.sort_by_key(|fixture| fixture.fid);
    document.fixtures = candidate;

    Ok(PatchCommandResult {
        document,
        selected_id: Some(fixture.id),
        message: format!("Saved fixture {}", fixture.fid),
    })
}

pub fn delete_fixture(document: PatchDocument, id: &str) -> PatchResult<PatchCommandResult> {
    let mut document = normalize_document(document);
    let initial_len = document.fixtures.len();
    document.fixtures.retain(|fixture| fixture.id != id);
    if document.fixtures.len() == initial_len {
        return Err(PatchError::InvalidFixture(format!(
            "fixture not found: {id}"
        )));
    }
    let selected_id = document.fixtures.first().map(|fixture| fixture.id.clone());

    Ok(PatchCommandResult {
        document,
        selected_id,
        message: "Deleted fixture".to_string(),
    })
}

pub fn duplicate_fixture(document: PatchDocument, id: &str) -> PatchResult<PatchCommandResult> {
    let mut document = normalize_document(document);
    let Some(source) = document
        .fixtures
        .iter()
        .find(|fixture| fixture.id == id)
        .cloned()
    else {
        return Err(PatchError::InvalidFixture(format!(
            "fixture not found: {id}"
        )));
    };

    let fixture = PatchFixture {
        id: format!("fix-{}", Uuid::new_v4()),
        fid: next_fid(&document.fixtures),
        name: format!("{} Copy", source.name),
        universe: None,
        address: None,
        ..source
    };
    let selected_id = fixture.id.clone();
    document.fixtures.push(fixture);
    document.fixtures.sort_by_key(|fixture| fixture.fid);

    Ok(PatchCommandResult {
        document,
        selected_id: Some(selected_id),
        message: "Duplicated fixture".to_string(),
    })
}

pub fn auto_patch(document: PatchDocument) -> PatchResult<PatchCommandResult> {
    let mut document = normalize_document(document);
    let mut patched: Vec<PatchFixture> = document
        .fixtures
        .iter()
        .filter(|fixture| fixture.universe.is_some() && fixture.address.is_some())
        .cloned()
        .collect();

    for fixture in &mut document.fixtures {
        if fixture.universe.is_some() && fixture.address.is_some() {
            continue;
        }
        let (universe, address) = find_next_free_patch(&patched, fixture.channels.max(1), 1, 1)?;
        fixture.universe = Some(universe);
        fixture.address = Some(address);
        patched.push(fixture.clone());
    }

    validate_fixtures(&document.fixtures)?;

    Ok(PatchCommandResult {
        document,
        selected_id: None,
        message: "Auto patched unassigned fixtures".to_string(),
    })
}

pub fn validate_fixtures(fixtures: &[PatchFixture]) -> PatchResult<()> {
    let mut fids = BTreeSet::new();
    for fixture in fixtures {
        if fixture.fid == 0 {
            return Err(PatchError::InvalidFixture(
                "fixture id must be greater than zero".to_string(),
            ));
        }
        if !fids.insert(fixture.fid) {
            return Err(PatchError::Conflict(format!(
                "FID {} already exists",
                fixture.fid
            )));
        }

        let Some(range) = patch_range(fixture) else {
            continue;
        };
        if range.end > 512 {
            return Err(PatchError::Conflict(format!(
                "Address {}.{} exceeds universe size",
                range.universe, range.start
            )));
        }
    }

    for (left_index, left) in fixtures.iter().enumerate() {
        let Some(left_range) = patch_range(left) else {
            continue;
        };
        for right in fixtures.iter().skip(left_index + 1) {
            if ranges_overlap(left_range, patch_range(right)) {
                return Err(PatchError::Conflict(format!(
                    "Address {}.{}-{} is occupied",
                    left_range.universe, left_range.start, left_range.end
                )));
            }
        }
    }

    Ok(())
}

fn normalize_fixture(mut fixture: PatchFixture) -> PatchFixture {
    fixture.fid = fixture.fid.max(1);
    fixture.channels = fixture.channels.max(1);
    fixture.universe = fixture.universe.map(clamp_universe);
    fixture.address = fixture.address.map(clamp_address);
    if fixture.stage.trim().is_empty() {
        fixture.stage = "Main".to_string();
    }
    fixture
}

fn normalize_wizard_draft(mut draft: PatchWizardDraft) -> PatchWizardDraft {
    draft.quantity = draft.quantity.clamp(1, 4096);
    draft.first_fid = draft.first_fid.max(1);
    draft.universe = clamp_universe(draft.universe);
    draft.address = clamp_address(draft.address);
    if draft.stage.trim().is_empty() {
        draft.stage = "Main".to_string();
    }
    draft
}

fn apply_fixture_patch(fixture: &mut PatchFixture, patch: PatchFixturePatch) {
    if let Some(value) = patch.fid {
        fixture.fid = value;
    }
    if let Some(value) = patch.name {
        fixture.name = value;
    }
    if let Some(value) = patch.fixture_type_id {
        fixture.fixture_type_id = value;
    }
    if let Some(value) = patch.fixture_type_name {
        fixture.fixture_type_name = value;
    }
    if let Some(value) = patch.fixture_type_path {
        fixture.fixture_type_path = value;
    }
    if let Some(value) = patch.mode_id {
        fixture.mode_id = value;
    }
    if let Some(value) = patch.mode_name {
        fixture.mode_name = value;
    }
    if let Some(value) = patch.channels {
        fixture.channels = value;
    }
    if let Some(value) = patch.universe {
        fixture.universe = value;
    }
    if let Some(value) = patch.address {
        fixture.address = value;
    }
    if let Some(value) = patch.stage {
        fixture.stage = value;
    }
    if let Some(value) = patch.pan_invert {
        fixture.pan_invert = value;
    }
    if let Some(value) = patch.tilt_invert {
        fixture.tilt_invert = value;
    }
}

fn next_fid(fixtures: &[PatchFixture]) -> u32 {
    fixtures
        .iter()
        .map(|fixture| fixture.fid)
        .max()
        .unwrap_or(0)
        + 1
}

fn find_next_free_patch(
    fixtures: &[PatchFixture],
    channels: u16,
    start_universe: u16,
    start_address: u16,
) -> PatchResult<(u16, u16)> {
    let mut universe = clamp_universe(start_universe);
    let mut address = clamp_address(start_address);

    while universe < 1024 {
        if address.saturating_add(channels).saturating_sub(1) <= 512 {
            let candidate = PatchFixture {
                id: "candidate".to_string(),
                fid: 0,
                name: String::new(),
                fixture_type_id: String::new(),
                fixture_type_name: String::new(),
                fixture_type_path: String::new(),
                mode_id: String::new(),
                mode_name: String::new(),
                channels,
                universe: Some(universe),
                address: Some(address),
                stage: "Main".to_string(),
                pan_invert: false,
                tilt_invert: false,
            };
            let range = patch_range(&candidate);
            if !fixtures.iter().any(|fixture| {
                ranges_overlap(range.expect("candidate has range"), patch_range(fixture))
            }) {
                return Ok((universe, address));
            }
        }

        address += 1;
        if address > 512 {
            universe += 1;
            address = 1;
        }
    }

    Err(PatchError::Conflict(
        "no free DMX address range found".to_string(),
    ))
}

fn patch_range(fixture: &PatchFixture) -> Option<DmxRange> {
    let universe = fixture.universe?;
    let start = fixture.address?;
    Some(DmxRange {
        universe,
        start,
        end: start + fixture.channels.max(1) - 1,
    })
}

fn ranges_overlap(left: DmxRange, right: Option<DmxRange>) -> bool {
    let Some(right) = right else {
        return false;
    };
    left.universe == right.universe && left.start <= right.end && right.start <= left.end
}

fn clamp_universe(value: u16) -> u16 {
    value.clamp(1, 1024)
}

fn clamp_address(value: u16) -> u16 {
    value.clamp(1, 512)
}

fn format_fixture_type_name(fixture_type: &FixtureTypeRef) -> String {
    format!("{} {}", fixture_type.manufacturer, fixture_type.name)
        .trim()
        .to_string()
}

fn default_if_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wizard_rejects_duplicate_fids_and_address_overlaps() {
        let fixture_type = fixture_type();
        let document = PatchDocument {
            fixtures: vec![PatchFixture {
                id: "existing".to_string(),
                fid: 1,
                name: "Existing".to_string(),
                fixture_type_id: fixture_type.id.clone(),
                fixture_type_name: fixture_type.name.clone(),
                fixture_type_path: fixture_type.path.clone(),
                mode_id: "default".to_string(),
                mode_name: "Default".to_string(),
                channels: 10,
                universe: Some(1),
                address: Some(1),
                stage: "Main".to_string(),
                pan_invert: false,
                tilt_invert: false,
            }],
        };

        let result = apply_wizard(
            document,
            fixture_type,
            PatchWizardDraft {
                fixture_type_path: "show://fixture-types/test.gdtf".to_string(),
                mode_id: "default".to_string(),
                quantity: 1,
                first_fid: 1,
                name_prefix: "Test".to_string(),
                channel_id: 1,
                universe: 1,
                address: 1,
                stage: "Main".to_string(),
            },
        );

        assert!(result.is_err());
    }

    #[test]
    fn wizard_auto_increments_address_and_universe() {
        let result = apply_wizard(
            PatchDocument::default(),
            fixture_type(),
            PatchWizardDraft {
                fixture_type_path: "show://fixture-types/test.gdtf".to_string(),
                mode_id: "default".to_string(),
                quantity: 2,
                first_fid: 1,
                name_prefix: "Test".to_string(),
                channel_id: 1,
                universe: 1,
                address: 500,
                stage: "Main".to_string(),
            },
        )
        .unwrap();

        assert_eq!(result.document.fixtures[0].address, Some(500));
        assert_eq!(result.document.fixtures[1].universe, Some(2));
        assert_eq!(result.document.fixtures[1].address, Some(1));
    }

    fn fixture_type() -> FixtureTypeRef {
        FixtureTypeRef {
            id: "type-1".to_string(),
            name: "Test".to_string(),
            manufacturer: "LimxDesk".to_string(),
            path: "show://fixture-types/test.gdtf".to_string(),
            modes: vec![FixtureModeRef {
                id: "default".to_string(),
                name: "Default".to_string(),
                channels: 10,
                attributes: vec!["Dimmer".to_string()],
            }],
        }
    }
}
