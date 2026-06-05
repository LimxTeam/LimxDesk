use limxdesk_cue::{
    format_cue_number, normalize_cue, Cue, CueStoreMode, CueValue, CueValueLayer, CueValueSource,
};
use limxdesk_programmer::{ProgrammerLayer, ProgrammerValue};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fmt};
use uuid::Uuid;

#[derive(Debug)]
pub enum SequenceError {
    MissingSequence(String),
    MissingCue(String),
    EmptyProgrammer,
    InvalidSequenceName(String),
    Cue(limxdesk_cue::CueError),
}

impl fmt::Display for SequenceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSequence(id) => write!(formatter, "sequence not found: {id}"),
            Self::MissingCue(id) => write!(formatter, "cue not found: {id}"),
            Self::EmptyProgrammer => write!(formatter, "no active programmer values to store"),
            Self::InvalidSequenceName(name) => write!(formatter, "invalid sequence name: {name}"),
            Self::Cue(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for SequenceError {}

impl From<limxdesk_cue::CueError> for SequenceError {
    fn from(value: limxdesk_cue::CueError) -> Self {
        Self::Cue(value)
    }
}

pub type SequenceResult<T> = Result<T, SequenceError>;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceDocument {
    pub sequences: Vec<Sequence>,
    pub selected_sequence_id: Option<String>,
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    pub id: String,
    pub number: u32,
    pub name: String,
    pub priority: u8,
    pub tracking: bool,
    pub release_on_off: bool,
    pub protected: bool,
    pub recipe_slots: Vec<SequenceRecipeSlot>,
    pub cues: Vec<Cue>,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceRecipeSlot {
    pub id: String,
    pub engine_kind: String,
    pub label: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceRuntimeState {
    pub sequence_id: String,
    pub active: bool,
    pub paused: bool,
    pub current_cue_id: Option<String>,
    pub previous_cue_id: Option<String>,
    pub next_cue_id: Option<String>,
    pub master: f64,
    pub rate: f64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceStoreRequest {
    pub sequence_id: Option<String>,
    pub cue_id: Option<String>,
    pub cue_number: Option<f64>,
    pub cue_name: Option<String>,
    pub store_mode: CueStoreMode,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleStepStoreRequest {
    pub sequence_id: Option<String>,
    pub name: Option<String>,
    pub store_mode: CueStoreMode,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CuePatch {
    pub name: Option<String>,
    pub number: Option<f64>,
    pub enabled: Option<bool>,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
    pub delay_in: Option<f64>,
    pub delay_out: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceCommandResult {
    pub document: SequenceDocument,
    pub sequence: Sequence,
    pub cue: Option<Cue>,
}

impl Sequence {
    pub fn new(number: u32, name: impl Into<String>, now_ms: u64) -> SequenceResult<Self> {
        let name = sanitize_sequence_name(name.into(), number)?;
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            number,
            name,
            priority: 50,
            tracking: true,
            release_on_off: true,
            protected: false,
            recipe_slots: Vec::new(),
            cues: Vec::new(),
            updated_at_ms: now_ms,
        })
    }

    pub fn active_cue_values(&self, state: &SequenceRuntimeState) -> Vec<CueValue> {
        if !state.active {
            return Vec::new();
        }

        let Some(current_cue_id) = state.current_cue_id.as_deref() else {
            return Vec::new();
        };

        if !self.tracking {
            return self
                .cues
                .iter()
                .find(|cue| cue.id == current_cue_id)
                .map(Cue::output_values)
                .unwrap_or_default();
        }

        let mut values = HashMap::<String, CueValue>::new();
        for cue in &self.cues {
            for value in cue.output_values() {
                values.insert(value_key(&value), value);
            }
            if cue.id == current_cue_id {
                break;
            }
        }
        values.into_values().collect()
    }
}

pub fn normalize_document(mut document: SequenceDocument) -> SequenceDocument {
    document.sequences = document.sequences.into_iter().map(normalize_sequence).collect();
    document.sequences.sort_by_key(|sequence| sequence.number);
    document.sequences.dedup_by_key(|sequence| sequence.id.clone());
    if let Some(selected) = document.selected_sequence_id.as_ref() {
        if !document.sequences.iter().any(|sequence| &sequence.id == selected) {
            document.selected_sequence_id = document.sequences.first().map(|sequence| sequence.id.clone());
        }
    }
    document
}

pub fn create_sequence(
    mut document: SequenceDocument,
    name: Option<String>,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    let number = next_sequence_number(&document);
    let sequence = Sequence::new(number, name.unwrap_or_default(), now_ms)?;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.sequences.push(sequence.clone());
    document.version = document.version.saturating_add(1);
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: None,
    })
}

pub fn store_programmer_values(
    mut document: SequenceDocument,
    request: SequenceStoreRequest,
    programmer_values: Vec<ProgrammerValue>,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    let cue_values = programmer_values_to_cue_values(programmer_values);
    if cue_values.is_empty() {
        return Err(SequenceError::EmptyProgrammer);
    }

    if document.sequences.is_empty() {
        let created = create_sequence(document, Some("Sequence 1".to_string()), now_ms)?;
        document = created.document;
    }

    let sequence_id = request
        .sequence_id
        .clone()
        .or(document.selected_sequence_id.clone())
        .or_else(|| document.sequences.first().map(|sequence| sequence.id.clone()))
        .ok_or_else(|| SequenceError::MissingSequence(String::new()))?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.clone()))?;

    let cue = if let Some(cue_id) = request.cue_id {
        let cue = sequence
            .cues
            .iter_mut()
            .find(|cue| cue.id == cue_id)
            .ok_or_else(|| SequenceError::MissingCue(cue_id.clone()))?;
        cue.merge_values(cue_values, request.store_mode, now_ms)?;
        cue.clone()
    } else {
        let number = request
            .cue_number
            .unwrap_or_else(|| next_cue_number(sequence));
        if let Some(cue) = sequence
            .cues
            .iter_mut()
            .find(|cue| (cue.number - number).abs() < f64::EPSILON)
        {
            cue.merge_values(cue_values, request.store_mode, now_ms)?;
            if let Some(name) = request.cue_name.filter(|name| !name.trim().is_empty()) {
                cue.name = name.trim().to_string();
            }
            cue.clone()
        } else {
            let cue = Cue::new(
                number,
                request
                    .cue_name
                    .unwrap_or_else(|| format!("Cue {}", format_cue_number(number))),
                cue_values,
                now_ms,
            )?;
            sequence.cues.push(cue.clone());
            sequence.cues.sort_by(|left, right| left.number.total_cmp(&right.number));
            cue
        }
    };

    sequence.updated_at_ms = now_ms;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.version = document.version.saturating_add(1);
    let sequence = sequence.clone();
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: Some(cue),
    })
}

pub fn store_single_step_program(
    mut document: SequenceDocument,
    request: SingleStepStoreRequest,
    programmer_values: Vec<ProgrammerValue>,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    let cue_values = programmer_values_to_cue_values(programmer_values);
    if cue_values.is_empty() {
        return Err(SequenceError::EmptyProgrammer);
    }

    let target_sequence_id = request.sequence_id.clone();
    if target_sequence_id.is_none() {
        let number = next_sequence_number(&document);
        let name = request
            .name
            .clone()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| format!("Single Step {number}"));
        let sequence = Sequence::new(number, name, now_ms)?;
        document.selected_sequence_id = Some(sequence.id.clone());
        document.sequences.push(sequence);
    }

    let sequence_id = target_sequence_id
        .or(document.selected_sequence_id.clone())
        .or_else(|| document.sequences.first().map(|sequence| sequence.id.clone()))
        .ok_or_else(|| SequenceError::MissingSequence(String::new()))?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.clone()))?;

    if let Some(name) = request.name.filter(|name| !name.trim().is_empty()) {
        sequence.name = sanitize_sequence_name(name, sequence.number)?;
    }

    let mut cue = sequence
        .cues
        .iter()
        .find(|cue| (cue.number - 1.0).abs() < f64::EPSILON)
        .cloned()
        .unwrap_or_else(|| {
            Cue::new(1.0, "Step 1", cue_values.clone(), now_ms)
                .expect("single step cue values were already validated")
        });
    cue.number = 1.0;
    cue.name = "Step 1".to_string();
    cue.merge_values(cue_values, request.store_mode, now_ms)?;

    sequence.cues = vec![cue.clone()];
    sequence.tracking = false;
    sequence.updated_at_ms = now_ms;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.version = document.version.saturating_add(1);
    let sequence = sequence.clone();
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: Some(cue),
    })
}

pub fn update_cue(
    mut document: SequenceDocument,
    sequence_id: &str,
    cue_id: &str,
    patch: CuePatch,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.to_string()))?;
    let cue = sequence
        .cues
        .iter_mut()
        .find(|cue| cue.id == cue_id)
        .ok_or_else(|| SequenceError::MissingCue(cue_id.to_string()))?;

    if let Some(name) = patch.name {
        cue.name = name.trim().chars().take(96).collect();
    }
    if let Some(number) = patch.number {
        limxdesk_cue::validate_cue_number(number)?;
        cue.number = limxdesk_cue::round_cue_number(number);
    }
    if let Some(enabled) = patch.enabled {
        cue.enabled = enabled;
    }
    if let Some(fade_in) = patch.fade_in {
        cue.timing.fade_in = clamp_time(fade_in);
    }
    if let Some(fade_out) = patch.fade_out {
        cue.timing.fade_out = clamp_time(fade_out);
    }
    if let Some(delay_in) = patch.delay_in {
        cue.timing.delay_in = clamp_time(delay_in);
    }
    if let Some(delay_out) = patch.delay_out {
        cue.timing.delay_out = clamp_time(delay_out);
    }
    if let Some(notes) = patch.notes {
        cue.notes = notes.chars().take(2048).collect();
    }
    cue.updated_at_ms = now_ms;
    let cue = cue.clone();
    sequence.cues.sort_by(|left, right| left.number.total_cmp(&right.number));
    sequence.updated_at_ms = now_ms;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.version = document.version.saturating_add(1);
    let sequence = sequence.clone();
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: Some(cue),
    })
}

pub fn delete_cue(
    mut document: SequenceDocument,
    sequence_id: &str,
    cue_id: &str,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.to_string()))?;
    let before = sequence.cues.len();
    sequence.cues.retain(|cue| cue.id != cue_id);
    if sequence.cues.len() == before {
        return Err(SequenceError::MissingCue(cue_id.to_string()));
    }
    sequence.updated_at_ms = now_ms;
    document.version = document.version.saturating_add(1);
    let sequence = sequence.clone();
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: None,
    })
}

pub fn delete_sequence(
    mut document: SequenceDocument,
    sequence_id: &str,
) -> SequenceResult<SequenceDocument> {
    document = normalize_document(document);
    let before = document.sequences.len();
    document.sequences.retain(|sequence| sequence.id != sequence_id);
    if document.sequences.len() == before {
        return Err(SequenceError::MissingSequence(sequence_id.to_string()));
    }
    if document.selected_sequence_id.as_deref() == Some(sequence_id) {
        document.selected_sequence_id = document.sequences.first().map(|sequence| sequence.id.clone());
    }
    document.version = document.version.saturating_add(1);
    Ok(normalize_document(document))
}

pub fn select_sequence(
    mut document: SequenceDocument,
    sequence_id: &str,
) -> SequenceResult<SequenceDocument> {
    document = normalize_document(document);
    if !document.sequences.iter().any(|sequence| sequence.id == sequence_id) {
        return Err(SequenceError::MissingSequence(sequence_id.to_string()));
    }
    document.selected_sequence_id = Some(sequence_id.to_string());
    document.version = document.version.saturating_add(1);
    Ok(document)
}

pub fn cue_output_values(sequence: &Sequence, state: &SequenceRuntimeState) -> Vec<CueValue> {
    let master = state.master.clamp(0.0, 1.0);
    sequence
        .active_cue_values(state)
        .into_iter()
        .map(|mut value| {
            if let Some(numeric) = value.numeric.as_mut() {
                *numeric *= master;
            }
            value
        })
        .collect()
}

pub fn advance_state(
    sequence: &Sequence,
    current: Option<SequenceRuntimeState>,
    direction: PlaybackDirection,
    now_ms: u64,
) -> SequenceRuntimeState {
    let mut state = current.unwrap_or_else(|| SequenceRuntimeState {
        sequence_id: sequence.id.clone(),
        active: false,
        paused: false,
        current_cue_id: None,
        previous_cue_id: None,
        next_cue_id: sequence.cues.first().map(|cue| cue.id.clone()),
        master: 1.0,
        rate: 1.0,
        updated_at_ms: now_ms,
    });

    let cue_ids = sequence
        .cues
        .iter()
        .filter(|cue| cue.enabled)
        .map(|cue| cue.id.clone())
        .collect::<Vec<_>>();
    if cue_ids.is_empty() {
        state.active = false;
        state.current_cue_id = None;
        state.next_cue_id = None;
        state.updated_at_ms = now_ms;
        return state;
    }

    let current_index = state
        .current_cue_id
        .as_ref()
        .and_then(|id| cue_ids.iter().position(|cue_id| cue_id == id));
    let next_index = match direction {
        PlaybackDirection::Go => current_index.map_or(0, |index| (index + 1).min(cue_ids.len() - 1)),
        PlaybackDirection::Back => current_index.map_or(0, |index| index.saturating_sub(1)),
    };
    state.previous_cue_id = state.current_cue_id.clone();
    state.current_cue_id = cue_ids.get(next_index).cloned();
    state.next_cue_id = cue_ids.get(next_index + 1).cloned();
    state.active = state.current_cue_id.is_some();
    state.paused = false;
    state.updated_at_ms = now_ms;
    state
}

pub fn goto_state(
    sequence: &Sequence,
    current: Option<SequenceRuntimeState>,
    cue_id: &str,
    now_ms: u64,
) -> SequenceResult<SequenceRuntimeState> {
    if !sequence.cues.iter().any(|cue| cue.id == cue_id) {
        return Err(SequenceError::MissingCue(cue_id.to_string()));
    }
    let mut state = current.unwrap_or_else(|| SequenceRuntimeState {
        sequence_id: sequence.id.clone(),
        ..SequenceRuntimeState::default()
    });
    let index = sequence
        .cues
        .iter()
        .position(|cue| cue.id == cue_id)
        .unwrap_or_default();
    state.previous_cue_id = state.current_cue_id.clone();
    state.current_cue_id = Some(cue_id.to_string());
    state.next_cue_id = sequence.cues.get(index + 1).map(|cue| cue.id.clone());
    state.active = true;
    state.paused = false;
    state.updated_at_ms = now_ms;
    Ok(state)
}

pub fn off_state(sequence_id: &str, current: Option<SequenceRuntimeState>, now_ms: u64) -> SequenceRuntimeState {
    let mut state = current.unwrap_or_else(|| SequenceRuntimeState {
        sequence_id: sequence_id.to_string(),
        ..SequenceRuntimeState::default()
    });
    state.active = false;
    state.paused = false;
    state.current_cue_id = None;
    state.next_cue_id = None;
    state.updated_at_ms = now_ms;
    state
}

pub fn set_master_state(
    sequence_id: &str,
    current: Option<SequenceRuntimeState>,
    master: f64,
    now_ms: u64,
) -> SequenceRuntimeState {
    let mut state = current.unwrap_or_else(|| SequenceRuntimeState {
        sequence_id: sequence_id.to_string(),
        master: 1.0,
        rate: 1.0,
        ..SequenceRuntimeState::default()
    });
    state.master = if master.is_finite() { master.clamp(0.0, 1.0) } else { 1.0 };
    state.updated_at_ms = now_ms;
    state
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackDirection {
    Go,
    Back,
}

fn normalize_sequence(mut sequence: Sequence) -> Sequence {
    if sequence.name.trim().is_empty() {
        sequence.name = format!("Sequence {}", sequence.number.max(1));
    } else {
        sequence.name = sequence.name.trim().chars().take(96).collect();
    }
    sequence.priority = sequence.priority.min(100);
    sequence.cues = sequence.cues.into_iter().map(normalize_cue).collect();
    sequence.cues.sort_by(|left, right| left.number.total_cmp(&right.number));
    sequence.cues.dedup_by(|left, right| left.id == right.id);
    sequence
}

fn next_sequence_number(document: &SequenceDocument) -> u32 {
    document
        .sequences
        .iter()
        .map(|sequence| sequence.number)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

fn next_cue_number(sequence: &Sequence) -> f64 {
    sequence
        .cues
        .iter()
        .map(|cue| cue.number)
        .max_by(|left, right| left.total_cmp(right))
        .unwrap_or(0.0)
        + 1.0
}

fn sanitize_sequence_name(name: String, number: u32) -> SequenceResult<String> {
    let name = name.trim();
    if name.len() > 96 {
        return Err(SequenceError::InvalidSequenceName(name.to_string()));
    }
    if name.is_empty() {
        Ok(format!("Sequence {number}"))
    } else {
        Ok(name.to_string())
    }
}

fn programmer_values_to_cue_values(values: Vec<ProgrammerValue>) -> Vec<CueValue> {
    values
        .into_iter()
        .filter(|value| value.active && !value.fixture_id.trim().is_empty() && !value.attribute.trim().is_empty())
        .map(|value| CueValue {
            fixture_id: value.fixture_id,
            attribute: value.attribute,
            feature_group: value.feature_group,
            layer: match value.layer {
                ProgrammerLayer::Absolute => CueValueLayer::Absolute,
                ProgrammerLayer::Relative => CueValueLayer::Relative,
                ProgrammerLayer::Fade => CueValueLayer::Fade,
                ProgrammerLayer::Delay => CueValueLayer::Delay,
            },
            numeric: value.value.numeric,
            text: value.value.text,
            active: value.active,
            source: CueValueSource::Programmer,
        })
        .collect()
}

fn value_key(value: &CueValue) -> String {
    format!("{}:{}:{:?}", value.fixture_id, value.attribute, value.layer)
}

fn clamp_time(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 9999.0)
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use limxdesk_programmer::{ProgrammerScalar, ProgrammerValueSource};

    #[test]
    fn store_creates_default_sequence_and_cue() {
        let result = store_programmer_values(
            SequenceDocument::default(),
            SequenceStoreRequest {
                sequence_id: None,
                cue_id: None,
                cue_number: None,
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Dimmer", 100.0)],
            10,
        )
        .unwrap();

        assert_eq!(result.document.sequences.len(), 1);
        assert_eq!(result.sequence.cues.len(), 1);
        assert_eq!(result.sequence.cues[0].parts[0].values.len(), 1);
    }

    #[test]
    fn single_step_store_forces_one_cue_only() {
        let result = store_programmer_values(
            SequenceDocument::default(),
            SequenceStoreRequest {
                sequence_id: None,
                cue_id: None,
                cue_number: None,
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Dimmer", 10.0)],
            10,
        )
        .unwrap();
        let sequence_id = result.sequence.id.clone();
        let result = store_programmer_values(
            result.document,
            SequenceStoreRequest {
                sequence_id: Some(sequence_id.clone()),
                cue_id: None,
                cue_number: None,
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Pan", 20.0)],
            11,
        )
        .unwrap();

        let result = store_single_step_program(
            result.document,
            SingleStepStoreRequest {
                sequence_id: Some(sequence_id),
                name: Some("Look A".to_string()),
                store_mode: CueStoreMode::Overwrite,
            },
            vec![programmer_value("1", "ColorRGB_R", 100.0)],
            12,
        )
        .unwrap();

        assert_eq!(result.sequence.name, "Look A");
        assert_eq!(result.sequence.cues.len(), 1);
        assert_eq!(result.sequence.cues[0].number, 1.0);
        assert_eq!(result.sequence.cues[0].parts[0].values.len(), 1);
        assert_eq!(result.sequence.cues[0].parts[0].values[0].attribute, "ColorRGB_R");
    }

    #[test]
    fn tracking_cue_outputs_prior_values() {
        let mut sequence = Sequence::new(1, "", 0).unwrap();
        sequence.cues.push(limxdesk_cue::Cue::new(1.0, "", vec![cue_value("1", "Dimmer", 40.0)], 0).unwrap());
        sequence.cues.push(limxdesk_cue::Cue::new(2.0, "", vec![cue_value("1", "Pan", 20.0)], 0).unwrap());
        let state = SequenceRuntimeState {
            sequence_id: sequence.id.clone(),
            active: true,
            current_cue_id: Some(sequence.cues[1].id.clone()),
            master: 1.0,
            rate: 1.0,
            ..SequenceRuntimeState::default()
        };

        let values = sequence.active_cue_values(&state);
        assert_eq!(values.len(), 2);
    }

    fn programmer_value(fixture_id: &str, attribute: &str, numeric: f64) -> ProgrammerValue {
        ProgrammerValue {
            fixture_id: fixture_id.to_string(),
            attribute: attribute.to_string(),
            feature_group: "Dimmer".to_string(),
            layer: ProgrammerLayer::Absolute,
            value: ProgrammerScalar {
                numeric: Some(numeric),
                text: None,
            },
            active: true,
            source: ProgrammerValueSource::Manual,
        }
    }

    fn cue_value(fixture_id: &str, attribute: &str, numeric: f64) -> CueValue {
        CueValue {
            fixture_id: fixture_id.to_string(),
            attribute: attribute.to_string(),
            feature_group: "Dimmer".to_string(),
            layer: CueValueLayer::Absolute,
            numeric: Some(numeric),
            text: None,
            active: true,
            source: CueValueSource::Programmer,
        }
    }
}
