use limxdesk_cue::{
    format_cue_number, normalize_cue, Cue, CueStoreMode, CueValue, CueValueLayer, CueValueSource,
};
use limxdesk_programmer::{ProgrammerLayer, ProgrammerValue};
use serde::{Deserialize, Serialize};
use std::fmt;
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

/// sequence 上的一个配方槽。
///
/// 槽本身不携带效果参数，只按 id 引用效果库里的对象 —— 同一个效果因此
/// 可以挂在多处，改一次处处生效；渲染路径也只需一次哈希查找，不必在
/// 每帧反序列化内联配置。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SequenceRecipeSlot {
    pub id: String,
    /// 由哪种引擎处理，对应 RecipeEngine::kind()。
    pub engine_kind: String,
    /// 引用的效果对象 id。
    #[serde(default)]
    pub effect_id: String,
    pub label: String,
    pub enabled: bool,
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
    pub sequence_number: Option<u32>,
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

    let target_sequence_id = request.sequence_id.clone().or_else(|| {
        request
            .sequence_number
            .and_then(|number| document.sequences.iter().find(|sequence| sequence.number == number).map(|sequence| sequence.id.clone()))
    });
    if target_sequence_id.is_none() {
        let number = request.sequence_number.unwrap_or_else(|| next_sequence_number(&document));
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

pub fn copy_cue_to_number(
    mut document: SequenceDocument,
    sequence_id: &str,
    source_number: f64,
    target_number: f64,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    limxdesk_cue::validate_cue_number(target_number)?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.to_string()))?;
    let source = sequence
        .cues
        .iter()
        .find(|cue| (cue.number - source_number).abs() < f64::EPSILON)
        .cloned()
        .ok_or_else(|| SequenceError::MissingCue(source_number.to_string()))?;

    let target_number = limxdesk_cue::round_cue_number(target_number);
    sequence.cues.retain(|cue| (cue.number - target_number).abs() >= f64::EPSILON);
    let mut copied = source;
    copied.id = Uuid::new_v4().to_string();
    copied.number = target_number;
    copied.name = format!("Cue {}", format_cue_number(target_number));
    copied.updated_at_ms = now_ms;
    sequence.cues.push(copied.clone());
    sequence.cues.sort_by(|left, right| left.number.total_cmp(&right.number));
    sequence.updated_at_ms = now_ms;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.version = document.version.saturating_add(1);
    let sequence = sequence.clone();
    Ok(SequenceCommandResult {
        document: normalize_document(document),
        sequence,
        cue: Some(copied),
    })
}

pub fn move_cue_to_number(
    mut document: SequenceDocument,
    sequence_id: &str,
    source_number: f64,
    target_number: f64,
    now_ms: u64,
) -> SequenceResult<SequenceCommandResult> {
    document = normalize_document(document);
    limxdesk_cue::validate_cue_number(target_number)?;
    let sequence = document
        .sequences
        .iter_mut()
        .find(|sequence| sequence.id == sequence_id)
        .ok_or_else(|| SequenceError::MissingSequence(sequence_id.to_string()))?;

    let source_index = sequence
        .cues
        .iter()
        .position(|cue| (cue.number - source_number).abs() < f64::EPSILON)
        .ok_or_else(|| SequenceError::MissingCue(source_number.to_string()))?;
    let target_number = limxdesk_cue::round_cue_number(target_number);
    if (source_number - target_number).abs() < f64::EPSILON {
        let cue = sequence.cues[source_index].clone();
        let sequence = sequence.clone();
        return Ok(SequenceCommandResult {
            document: normalize_document(document),
            sequence,
            cue: Some(cue),
        });
    }

    let mut cue = sequence.cues.remove(source_index);
    sequence.cues.retain(|item| (item.number - target_number).abs() >= f64::EPSILON);
    cue.number = target_number;
    cue.name = format!("Cue {}", format_cue_number(target_number));
    cue.updated_at_ms = now_ms;
    sequence.cues.push(cue.clone());
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

pub fn copy_sequence_to_number(
    mut document: SequenceDocument,
    source_number: u32,
    target_number: u32,
    now_ms: u64,
) -> SequenceResult<SequenceDocument> {
    document = normalize_document(document);
    let source = document
        .sequences
        .iter()
        .find(|sequence| sequence.number == source_number)
        .cloned()
        .ok_or_else(|| SequenceError::MissingSequence(source_number.to_string()))?;
    document.sequences.retain(|sequence| sequence.number != target_number);

    let mut copied = source;
    copied.id = Uuid::new_v4().to_string();
    copied.number = target_number.max(1);
    copied.name = sanitize_sequence_name(copied.name, copied.number)?;
    copied.updated_at_ms = now_ms;
    for cue in &mut copied.cues {
        cue.id = Uuid::new_v4().to_string();
        cue.updated_at_ms = now_ms;
    }

    document.selected_sequence_id = Some(copied.id.clone());
    document.sequences.push(copied);
    document.version = document.version.saturating_add(1);
    Ok(normalize_document(document))
}

pub fn move_sequence_to_number(
    mut document: SequenceDocument,
    source_number: u32,
    target_number: u32,
    now_ms: u64,
) -> SequenceResult<SequenceDocument> {
    document = normalize_document(document);
    if source_number == target_number {
        return Ok(document);
    }

    let index = document
        .sequences
        .iter()
        .position(|sequence| sequence.number == source_number)
        .ok_or_else(|| SequenceError::MissingSequence(source_number.to_string()))?;
    let mut sequence = document.sequences.remove(index);
    document.sequences.retain(|item| item.number != target_number);
    sequence.number = target_number.max(1);
    sequence.name = sanitize_sequence_name(sequence.name, sequence.number)?;
    sequence.updated_at_ms = now_ms;
    document.selected_sequence_id = Some(sequence.id.clone());
    document.sequences.push(sequence);
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
                sequence_number: None,
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
    fn copy_sequence_rekeys_ids_and_replaces_target_number() {
        let result = store_single_step_program(
            SequenceDocument::default(),
            SingleStepStoreRequest {
                sequence_id: None,
                sequence_number: Some(1),
                name: Some("Look".to_string()),
                store_mode: CueStoreMode::Overwrite,
            },
            vec![programmer_value("1", "Dimmer", 100.0)],
            10,
        )
        .unwrap();
        let source_id = result.sequence.id.clone();
        let source_cue_id = result.sequence.cues[0].id.clone();

        let document = copy_sequence_to_number(result.document, 1, 2, 11).unwrap();
        let source = document.sequences.iter().find(|sequence| sequence.number == 1).unwrap();
        let copied = document.sequences.iter().find(|sequence| sequence.number == 2).unwrap();

        assert_eq!(document.sequences.len(), 2);
        assert_eq!(source.id, source_id);
        assert_ne!(copied.id, source_id);
        assert_ne!(copied.cues[0].id, source_cue_id);
        assert_eq!(document.selected_sequence_id.as_deref(), Some(copied.id.as_str()));
    }

    #[test]
    fn move_sequence_replaces_target_number_without_rekeying() {
        let first = store_single_step_program(
            SequenceDocument::default(),
            SingleStepStoreRequest {
                sequence_id: None,
                sequence_number: Some(1),
                name: Some("Source".to_string()),
                store_mode: CueStoreMode::Overwrite,
            },
            vec![programmer_value("1", "Dimmer", 100.0)],
            10,
        )
        .unwrap();
        let source_id = first.sequence.id.clone();
        let second = store_single_step_program(
            first.document,
            SingleStepStoreRequest {
                sequence_id: None,
                sequence_number: Some(2),
                name: Some("Target".to_string()),
                store_mode: CueStoreMode::Overwrite,
            },
            vec![programmer_value("2", "Dimmer", 50.0)],
            11,
        )
        .unwrap();

        let document = move_sequence_to_number(second.document, 1, 2, 12).unwrap();

        assert_eq!(document.sequences.len(), 1);
        assert_eq!(document.sequences[0].number, 2);
        assert_eq!(document.sequences[0].id, source_id);
        assert_eq!(document.selected_sequence_id.as_deref(), Some(source_id.as_str()));
    }

    #[test]
    fn copy_cue_rekeys_id_and_replaces_target_number() {
        let first = store_programmer_values(
            SequenceDocument::default(),
            SequenceStoreRequest {
                sequence_id: None,
                cue_id: None,
                cue_number: Some(1.0),
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Dimmer", 100.0)],
            10,
        )
        .unwrap();
        let sequence_id = first.sequence.id.clone();
        let cue_id = first.cue.as_ref().unwrap().id.clone();

        let result = copy_cue_to_number(first.document, &sequence_id, 1.0, 2.5, 11).unwrap();

        assert_eq!(result.sequence.cues.len(), 2);
        let copied = result.sequence.cues.iter().find(|cue| (cue.number - 2.5).abs() < f64::EPSILON).unwrap();
        assert_ne!(copied.id, cue_id);
        assert_eq!(copied.name, "Cue 2.5");
    }

    #[test]
    fn move_cue_replaces_target_number_without_rekeying() {
        let first = store_programmer_values(
            SequenceDocument::default(),
            SequenceStoreRequest {
                sequence_id: None,
                cue_id: None,
                cue_number: Some(1.0),
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Dimmer", 100.0)],
            10,
        )
        .unwrap();
        let sequence_id = first.sequence.id.clone();
        let moved_id = first.cue.as_ref().unwrap().id.clone();
        let second = store_programmer_values(
            first.document,
            SequenceStoreRequest {
                sequence_id: Some(sequence_id.clone()),
                cue_id: None,
                cue_number: Some(2.0),
                cue_name: None,
                store_mode: CueStoreMode::Merge,
            },
            vec![programmer_value("1", "Pan", 50.0)],
            11,
        )
        .unwrap();

        let result = move_cue_to_number(second.document, &sequence_id, 1.0, 2.0, 12).unwrap();

        assert_eq!(result.sequence.cues.len(), 1);
        assert_eq!(result.sequence.cues[0].id, moved_id);
        assert_eq!(result.sequence.cues[0].number, 2.0);
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

}
