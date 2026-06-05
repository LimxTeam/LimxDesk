use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt};

pub const DMX_UNIVERSE_SIZE: usize = 512;

#[derive(Debug)]
pub enum DmxError {
    InvalidAddress(String),
}

impl fmt::Display for DmxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidAddress(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for DmxError {}

pub type DmxResult<T> = Result<T, DmxError>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxRenderInput {
    pub fixtures: Vec<DmxFixturePatch>,
    pub fixture_types: Vec<DmxFixtureTypeProfile>,
    pub programmer_values: Vec<DmxProgrammerValue>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxFixturePatch {
    pub id: String,
    pub fixture_type_id: String,
    pub fixture_type_path: String,
    pub mode_id: String,
    pub mode_name: String,
    pub universe: Option<u16>,
    pub address: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxFixtureTypeProfile {
    pub id: String,
    pub path: String,
    pub modes: Vec<DmxModeProfile>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxModeProfile {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<DmxAttributeProfile>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxAttributeProfile {
    pub name: String,
    pub feature_group: String,
    pub value_kind: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub dmx_slots: Vec<DmxAttributeSlot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxAttributeSlot {
    pub module_id: Option<String>,
    pub offsets: Vec<u16>,
    pub physical_from: Option<f64>,
    pub physical_to: Option<f64>,
    pub default_raw: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DmxProgrammerValue {
    pub fixture_id: String,
    pub attribute: String,
    pub numeric: Option<f64>,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DmxUniverseFrame {
    pub universe: u16,
    pub data: Vec<u8>,
}

pub fn render_programmer_to_dmx(input: &DmxRenderInput) -> DmxResult<Vec<DmxUniverseFrame>> {
    let mut universes = BTreeMap::<u16, [u8; DMX_UNIVERSE_SIZE]>::new();

    for fixture in &input.fixtures {
        render_fixture_defaults(input, fixture, &mut universes)?;
    }

    for value in input.programmer_values.iter().filter(|value| value.active) {
        let parent_id = parent_fixture_id(&value.fixture_id);
        let Some(fixture) = input
            .fixtures
            .iter()
            .find(|fixture| fixture.id == parent_id)
        else {
            continue;
        };
        let (Some(universe), Some(address)) = (fixture.universe, fixture.address) else {
            continue;
        };
        if address == 0 || address > DMX_UNIVERSE_SIZE as u16 {
            return Err(DmxError::InvalidAddress(format!(
                "invalid DMX address {}.{}",
                universe, address
            )));
        }

        let Some(mode) = resolve_mode(input, fixture) else {
            continue;
        };
        let Some(attribute) = mode
            .attributes
            .iter()
            .find(|item| item.name == value.attribute)
        else {
            continue;
        };
        let module_id = selected_module_id(&value.fixture_id);
        let universe_data = universes
            .entry(universe)
            .or_insert([0_u8; DMX_UNIVERSE_SIZE]);

        for slot in &attribute.dmx_slots {
            if module_id.is_some() && slot.module_id.as_deref() != module_id {
                continue;
            }

            let dmx_bytes = encode_attribute_bytes(
                attribute,
                slot,
                value.numeric.unwrap_or(0.0),
                slot.offsets.len(),
            );
            for (byte_index, offset) in slot.offsets.iter().enumerate() {
                if *offset == 0 {
                    continue;
                }
                let index = usize::from(address - 1) + usize::from(*offset - 1);
                if index < DMX_UNIVERSE_SIZE {
                    universe_data[index] = dmx_bytes.get(byte_index).copied().unwrap_or(0);
                }
            }
        }
    }

    Ok(universes
        .into_iter()
        .map(|(universe, data)| DmxUniverseFrame {
            universe,
            data: data.to_vec(),
        })
        .collect())
}

fn render_fixture_defaults(
    input: &DmxRenderInput,
    fixture: &DmxFixturePatch,
    universes: &mut BTreeMap<u16, [u8; DMX_UNIVERSE_SIZE]>,
) -> DmxResult<()> {
    let (Some(universe), Some(address)) = (fixture.universe, fixture.address) else {
        return Ok(());
    };
    if address == 0 || address > DMX_UNIVERSE_SIZE as u16 {
        return Err(DmxError::InvalidAddress(format!(
            "invalid DMX address {}.{}",
            universe, address
        )));
    }

    let Some(mode) = resolve_mode(input, fixture) else {
        return Ok(());
    };
    let universe_data = universes
        .entry(universe)
        .or_insert([0_u8; DMX_UNIVERSE_SIZE]);

    for attribute in &mode.attributes {
        for slot in &attribute.dmx_slots {
            let Some(raw) = slot.default_raw else {
                continue;
            };
            let dmx_bytes = encode_raw_dmx_bytes(raw, slot.offsets.len());
            for (byte_index, offset) in slot.offsets.iter().enumerate() {
                if *offset == 0 {
                    continue;
                }
                let index = usize::from(address - 1) + usize::from(*offset - 1);
                if index < DMX_UNIVERSE_SIZE {
                    universe_data[index] = dmx_bytes.get(byte_index).copied().unwrap_or(0);
                }
            }
        }
    }

    Ok(())
}

fn resolve_mode<'a>(
    input: &'a DmxRenderInput,
    fixture: &DmxFixturePatch,
) -> Option<&'a DmxModeProfile> {
    let fixture_type = input.fixture_types.iter().find(|item| {
        item.path == fixture.fixture_type_path || item.id == fixture.fixture_type_id
    })?;
    fixture_type
        .modes
        .iter()
        .find(|mode| mode.id == fixture.mode_id)
        .or_else(|| {
            fixture_type
                .modes
                .iter()
                .find(|mode| mode.name == fixture.mode_name)
        })
        .or_else(|| fixture_type.modes.first())
}

fn encode_attribute_bytes(
    attribute: &DmxAttributeProfile,
    slot: &DmxAttributeSlot,
    value: f64,
    resolution: usize,
) -> Vec<u8> {
    let normalized = match attribute.value_kind.as_str() {
        "percent" => normalize(value, 0.0, 100.0),
        _ => {
            let from = slot.physical_from.or(attribute.min_value).unwrap_or(0.0);
            let to = slot.physical_to.or(attribute.max_value).unwrap_or(255.0);
            normalize_directional(value, from, to)
        }
    };

    if resolution >= 2 {
        let value = (normalized * 65_535.0).round() as u16;
        vec![(value >> 8) as u8, (value & 0xff) as u8]
    } else {
        vec![(normalized * 255.0).round() as u8]
    }
}

fn encode_raw_dmx_bytes(raw: f64, resolution: usize) -> Vec<u8> {
    if !raw.is_finite() {
        return vec![0; resolution.max(1)];
    }
    if resolution >= 2 {
        let value = raw.round().clamp(0.0, 65_535.0) as u16;
        vec![(value >> 8) as u8, (value & 0xff) as u8]
    } else {
        vec![raw.round().clamp(0.0, 255.0) as u8]
    }
}

fn normalize(value: f64, min: f64, max: f64) -> f64 {
    if !value.is_finite() || max <= min {
        return 0.0;
    }
    ((value - min) / (max - min)).clamp(0.0, 1.0)
}

fn normalize_directional(value: f64, from: f64, to: f64) -> f64 {
    if !value.is_finite() || !from.is_finite() || !to.is_finite() || from == to {
        return 0.0;
    }
    ((value - from) / (to - from)).clamp(0.0, 1.0)
}

fn parent_fixture_id(id: &str) -> &str {
    id.split("::sub:").next().unwrap_or(id)
}

fn selected_module_id(id: &str) -> Option<&str> {
    id.split_once("::sub:").map(|(_, module_id)| module_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_parent_fixture_attribute_to_all_matching_slots() {
        let frames = render_programmer_to_dmx(&input("fix-1")).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data[0], 255);
        assert_eq!(frames[0].data[3], 255);
    }

    #[test]
    fn renders_sub_fixture_attribute_to_selected_module_only() {
        let frames = render_programmer_to_dmx(&input("fix-1::sub:module-2")).unwrap();
        assert_eq!(frames[0].data[0], 0);
        assert_eq!(frames[0].data[3], 255);
    }

    #[test]
    fn renders_sixteen_bit_attribute_as_coarse_and_fine() {
        let mut input = input("fix-1");
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[0].offsets = vec![1, 2];
        input.fixture_types[0].modes[0].attributes[0]
            .dmx_slots
            .truncate(1);
        input.programmer_values[0].numeric = Some(50.0);

        let frames = render_programmer_to_dmx(&input).unwrap();
        assert_eq!(frames[0].data[0], 128);
        assert_eq!(frames[0].data[1], 0);
    }

    #[test]
    fn renders_zero_percent_as_zero_dmx() {
        let mut input = input("fix-1");
        input.programmer_values[0].numeric = Some(0.0);

        let frames = render_programmer_to_dmx(&input).unwrap();
        assert_eq!(frames[0].data[0], 0);
        assert_eq!(frames[0].data[3], 0);
    }

    #[test]
    fn renders_directional_sixteen_bit_physical_range() {
        let mut input = input("fix-1");
        input.fixture_types[0].modes[0].attributes[0].name = "Pan".to_string();
        input.fixture_types[0].modes[0].attributes[0].feature_group = "Position".to_string();
        input.fixture_types[0].modes[0].attributes[0].value_kind = "angle".to_string();
        input.fixture_types[0].modes[0].attributes[0].dmx_slots = vec![DmxAttributeSlot {
            module_id: None,
            offsets: vec![1, 2],
            physical_from: Some(32.5),
            physical_to: Some(-32.5),
            default_raw: None,
        }];
        input.programmer_values[0].attribute = "Pan".to_string();

        input.programmer_values[0].numeric = Some(32.5);
        let frames = render_programmer_to_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[0, 0]);

        input.programmer_values[0].numeric = Some(0.0);
        let frames = render_programmer_to_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[128, 0]);

        input.programmer_values[0].numeric = Some(-32.5);
        let frames = render_programmer_to_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[255, 255]);
    }

    #[test]
    fn renders_fixture_defaults_without_active_programmer_values() {
        let mut input = input("fix-1");
        input.programmer_values.clear();
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[0].default_raw = Some(7.0);
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[1].default_raw = Some(9.0);

        let frames = render_programmer_to_dmx(&input).unwrap();

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data[0], 7);
        assert_eq!(frames[0].data[3], 9);
    }

    #[test]
    fn active_programmer_values_override_fixture_defaults() {
        let mut input = input("fix-1");
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[0].default_raw = Some(7.0);
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[1].default_raw = Some(9.0);
        input.programmer_values[0].numeric = Some(100.0);

        let frames = render_programmer_to_dmx(&input).unwrap();

        assert_eq!(frames[0].data[0], 255);
        assert_eq!(frames[0].data[3], 255);
    }

    fn input(fixture_id: &str) -> DmxRenderInput {
        DmxRenderInput {
            fixtures: vec![DmxFixturePatch {
                id: "fix-1".to_string(),
                fixture_type_id: "type-1".to_string(),
                fixture_type_path: "show://fixture-types/type-1.gdtf".to_string(),
                mode_id: "mode-0".to_string(),
                mode_name: "Default".to_string(),
                universe: Some(1),
                address: Some(1),
            }],
            fixture_types: vec![DmxFixtureTypeProfile {
                id: "type-1".to_string(),
                path: "show://fixture-types/type-1.gdtf".to_string(),
                modes: vec![DmxModeProfile {
                    id: "mode-0".to_string(),
                    name: "Default".to_string(),
                    channels: 6,
                    attributes: vec![DmxAttributeProfile {
                        name: "Dimmer".to_string(),
                        feature_group: "Dimmer".to_string(),
                        value_kind: "percent".to_string(),
                        min_value: Some(0.0),
                        max_value: Some(1.0),
                        dmx_slots: vec![
                            DmxAttributeSlot {
                                module_id: Some("module-1".to_string()),
                                offsets: vec![1],
                                physical_from: Some(0.0),
                                physical_to: Some(100.0),
                                default_raw: None,
                            },
                            DmxAttributeSlot {
                                module_id: Some("module-2".to_string()),
                                offsets: vec![4],
                                physical_from: Some(0.0),
                                physical_to: Some(100.0),
                                default_raw: None,
                            },
                        ],
                    }],
                }],
            }],
            programmer_values: vec![DmxProgrammerValue {
                fixture_id: fixture_id.to_string(),
                attribute: "Dimmer".to_string(),
                numeric: Some(100.0),
                active: true,
            }],
        }
    }
}
