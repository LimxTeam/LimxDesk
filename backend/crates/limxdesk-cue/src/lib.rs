use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug)]
pub enum CueError {
    EmptyValues,
    InvalidCueNumber(f64),
    InvalidName(String),
}

impl fmt::Display for CueError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyValues => write!(formatter, "no programmer values to store"),
            Self::InvalidCueNumber(number) => write!(formatter, "invalid cue number: {number}"),
            Self::InvalidName(name) => write!(formatter, "invalid cue name: {name}"),
        }
    }
}

impl std::error::Error for CueError {}

pub type CueResult<T> = Result<T, CueError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub id: String,
    pub number: f64,
    pub name: String,
    pub trigger: CueTrigger,
    pub timing: CueTiming,
    pub parts: Vec<CuePart>,
    pub appearance: CueAppearance,
    pub enabled: bool,
    pub notes: String,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CuePart {
    pub id: u16,
    pub name: String,
    pub timing: CueTiming,
    pub values: Vec<CueValue>,
    pub steps: Vec<CueStep>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CueStep {
    pub id: u16,
    pub name: String,
    pub timing: CueTiming,
    pub values: Vec<CueValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CueValue {
    pub fixture_id: String,
    pub attribute: String,
    pub feature_group: String,
    pub layer: CueValueLayer,
    pub numeric: Option<f64>,
    pub text: Option<String>,
    pub active: bool,
    pub source: CueValueSource,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CueValueLayer {
    Absolute,
    Relative,
    Fade,
    Delay,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CueValueSource {
    Programmer,
    Preset,
    Recipe,
    Effect,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CueTiming {
    pub fade_in: f64,
    pub fade_out: f64,
    pub delay_in: f64,
    pub delay_out: f64,
    pub duration: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CueTrigger {
    pub kind: CueTriggerKind,
    pub time: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CueTriggerKind {
    Go,
    Time,
    Follow,
    Sound,
    Midi,
    Timecode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CueAppearance {
    pub color: String,
    pub marker: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CueStoreMode {
    Merge,
    Overwrite,
    Remove,
}

impl Default for CueTiming {
    fn default() -> Self {
        Self {
            fade_in: 0.0,
            fade_out: 0.0,
            delay_in: 0.0,
            delay_out: 0.0,
            duration: None,
        }
    }
}

impl Default for CueTrigger {
    fn default() -> Self {
        Self {
            kind: CueTriggerKind::Go,
            time: None,
        }
    }
}

impl Default for CueAppearance {
    fn default() -> Self {
        Self {
            color: "#2A2F3A".to_string(),
            marker: String::new(),
        }
    }
}

impl Cue {
    pub fn new(number: f64, name: impl Into<String>, values: Vec<CueValue>, now_ms: u64) -> CueResult<Self> {
        validate_cue_number(number)?;
        if values.is_empty() {
            return Err(CueError::EmptyValues);
        }

        let name = sanitize_name(name.into(), number)?;
        Ok(Self {
            id: Uuid::new_v4().to_string(),
            number,
            name,
            trigger: CueTrigger::default(),
            timing: CueTiming::default(),
            parts: vec![CuePart {
                id: 0,
                name: "Main".to_string(),
                timing: CueTiming::default(),
                values,
                steps: Vec::new(),
            }],
            appearance: CueAppearance::default(),
            enabled: true,
            notes: String::new(),
            updated_at_ms: now_ms,
        })
    }

    pub fn value_count(&self) -> usize {
        self.parts
            .iter()
            .map(|part| part.values.len() + part.steps.iter().map(|step| step.values.len()).sum::<usize>())
            .sum()
    }

    pub fn output_values(&self) -> Vec<CueValue> {
        if !self.enabled {
            return Vec::new();
        }

        self.parts
            .iter()
            .flat_map(|part| part.values.iter().chain(part.steps.iter().flat_map(|step| step.values.iter())))
            .filter(|value| value.active)
            .cloned()
            .collect()
    }

    pub fn merge_values(&mut self, values: Vec<CueValue>, mode: CueStoreMode, now_ms: u64) -> CueResult<()> {
        if values.is_empty() {
            return Err(CueError::EmptyValues);
        }

        let part = self.ensure_main_part();
        match mode {
            CueStoreMode::Overwrite => {
                part.values = values;
            }
            CueStoreMode::Merge => {
                for value in values {
                    upsert_value(&mut part.values, value);
                }
            }
            CueStoreMode::Remove => {
                for value in values {
                    part.values.retain(|existing| !same_value_address(existing, &value));
                }
            }
        }
        self.updated_at_ms = now_ms;
        Ok(())
    }

    fn ensure_main_part(&mut self) -> &mut CuePart {
        if !self.parts.iter().any(|part| part.id == 0) {
            self.parts.insert(
                0,
                CuePart {
                    id: 0,
                    name: "Main".to_string(),
                    timing: CueTiming::default(),
                    values: Vec::new(),
                    steps: Vec::new(),
                },
            );
        }
        self.parts
            .iter_mut()
            .find(|part| part.id == 0)
            .expect("main part exists")
    }
}

pub fn normalize_cue(mut cue: Cue) -> Cue {
    cue.number = if cue.number.is_finite() && cue.number > 0.0 {
        round_cue_number(cue.number)
    } else {
        1.0
    };
    cue.name = sanitize_name(cue.name, cue.number).unwrap_or_else(|_| format!("Cue {}", cue.number));
    cue.timing = normalize_timing(cue.timing);
    cue.parts = cue
        .parts
        .into_iter()
        .map(|mut part| {
            part.timing = normalize_timing(part.timing);
            part.values = part.values.into_iter().filter(valid_value).collect();
            part.steps = part
                .steps
                .into_iter()
                .map(|mut step| {
                    step.timing = normalize_timing(step.timing);
                    step.values = step.values.into_iter().filter(valid_value).collect();
                    step
                })
                .collect();
            part
        })
        .collect();
    cue
}

pub fn validate_cue_number(number: f64) -> CueResult<()> {
    if !number.is_finite() || number <= 0.0 || number > 999_999.0 {
        return Err(CueError::InvalidCueNumber(number));
    }
    Ok(())
}

pub fn round_cue_number(number: f64) -> f64 {
    (number * 1000.0).round() / 1000.0
}

fn sanitize_name(name: String, number: f64) -> CueResult<String> {
    let name = name.trim();
    if name.len() > 96 {
        return Err(CueError::InvalidName(name.to_string()));
    }
    if name.is_empty() {
        Ok(format!("Cue {}", format_cue_number(number)))
    } else {
        Ok(name.to_string())
    }
}

pub fn format_cue_number(number: f64) -> String {
    let rounded = round_cue_number(number);
    if (rounded - rounded.round()).abs() < f64::EPSILON {
        format!("{}", rounded as u64)
    } else {
        format!("{rounded:.3}").trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn normalize_timing(timing: CueTiming) -> CueTiming {
    CueTiming {
        fade_in: finite_range(timing.fade_in, 0.0, 9999.0),
        fade_out: finite_range(timing.fade_out, 0.0, 9999.0),
        delay_in: finite_range(timing.delay_in, 0.0, 9999.0),
        delay_out: finite_range(timing.delay_out, 0.0, 9999.0),
        duration: timing
            .duration
            .filter(|duration| duration.is_finite())
            .map(|duration| finite_range(duration, 0.0, 9999.0)),
    }
}

fn valid_value(value: &CueValue) -> bool {
    !value.fixture_id.trim().is_empty() && !value.attribute.trim().is_empty()
}

fn upsert_value(values: &mut Vec<CueValue>, value: CueValue) {
    if let Some(existing) = values.iter_mut().find(|existing| same_value_address(existing, &value)) {
        *existing = value;
    } else {
        values.push(value);
    }
}

fn same_value_address(left: &CueValue, right: &CueValue) -> bool {
    left.fixture_id == right.fixture_id && left.attribute == right.attribute && left.layer == right.layer
}

fn finite_range(value: f64, min: f64, max: f64) -> f64 {
    if !value.is_finite() {
        return min;
    }
    value.clamp(min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cue_number_formats_without_trailing_zeroes() {
        assert_eq!(format_cue_number(1.0), "1");
        assert_eq!(format_cue_number(1.5), "1.5");
        assert_eq!(format_cue_number(1.125), "1.125");
    }

    #[test]
    fn merge_replaces_matching_value_address() {
        let mut cue = Cue::new(1.0, "", vec![value("1", "Dimmer", 10.0)], 1).unwrap();
        cue.merge_values(vec![value("1", "Dimmer", 80.0)], CueStoreMode::Merge, 2)
            .unwrap();
        assert_eq!(cue.parts[0].values.len(), 1);
        assert_eq!(cue.parts[0].values[0].numeric, Some(80.0));
    }

    fn value(fixture_id: &str, attribute: &str, numeric: f64) -> CueValue {
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
