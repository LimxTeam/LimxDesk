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
    pub output_values: Vec<DmxOutputValue>,
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
pub struct DmxOutputValue {
    pub fixture_id: String,
    pub attribute: String,
    pub numeric: Option<f64>,
    pub active: bool,
    pub source: DmxChannelSource,
    /// 同一 source 层内的相对优先级，直接来自 Sequence.priority。
    #[serde(default)]
    pub priority: u8,
    /// 该属性的合并方式。由属性的 feature group 决定，不由取值决定 ——
    /// 同一属性的所有贡献者必须给出一致的模式，否则合并结果不可预测。
    #[serde(default)]
    pub merge: DmxMergeMode,
    /// 优先级相同时的确定性排序依据（executor 编号等）。存在的意义是
    /// 让"谁覆盖谁"可复现，而不是取决于哈希表的遍历顺序。
    #[serde(default)]
    pub order: u32,
}

impl DmxOutputValue {
    /// 构造一个 LTP、零优先级的值。programmer 一类的单一来源用这个。
    pub fn simple(
        fixture_id: impl Into<String>,
        attribute: impl Into<String>,
        numeric: Option<f64>,
        active: bool,
        source: DmxChannelSource,
    ) -> Self {
        Self {
            fixture_id: fixture_id.into(),
            attribute: attribute.into(),
            numeric,
            active,
            source,
            priority: 0,
            merge: DmxMergeMode::Ltp,
            order: 0,
        }
    }
}

/// 合并方式。
///
/// `Htp`（Highest Takes Precedence）用于强度类属性：多个回放同时驱动同一个
/// 调光通道时取最大值，这样压下一个推子不会把另一个回放的光也带走。
/// `Ltp`（Latest Takes Precedence）用于位置、颜色一类属性：由优先级最高的
/// 贡献者独占，取最大值在这些属性上没有物理意义。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DmxMergeMode {
    Htp,
    #[default]
    Ltp,
}

/// 按 feature group 判定属性的合并方式。
pub fn merge_mode_for_feature_group(feature_group: &str) -> DmxMergeMode {
    if feature_group.eq_ignore_ascii_case("Dimmer") {
        DmxMergeMode::Htp
    } else {
        DmxMergeMode::Ltp
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DmxUniverseFrame {
    pub universe: u16,
    pub data: Vec<u8>,
    pub sources: Vec<DmxChannelSource>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DmxChannelSource {
    #[default]
    None,
    Default,
    Sequence,
    Effect,
    Programmer,
}

pub fn render_dmx(input: &DmxRenderInput) -> DmxResult<Vec<DmxUniverseFrame>> {
    let mut universes = BTreeMap::<u16, [u8; DMX_UNIVERSE_SIZE]>::new();
    let mut sources = BTreeMap::<u16, [DmxChannelSource; DMX_UNIVERSE_SIZE]>::new();

    for fixture in &input.fixtures {
        render_fixture_defaults(input, fixture, &mut universes, &mut sources)?;
    }

    for value in merge_output_values(&input.output_values) {
        render_output_value(input, value, &mut universes, &mut sources)?;
    }

    Ok(universes
        .into_iter()
        .map(|(universe, data)| {
            let source_data = sources
                .remove(&universe)
                .unwrap_or([DmxChannelSource::None; DMX_UNIVERSE_SIZE]);
            DmxUniverseFrame {
                universe,
                data: data.to_vec(),
                sources: source_data.to_vec(),
            }
        })
        .collect())
}

/// 在值层归约到"每个 (fixture, attribute) 一个胜出值"，再交给编码。
///
/// 旧实现是把所有值按 source 排序后逐个写进 DMX 字节数组，靠后写覆盖决定胜负。
/// 那样做有两个问题：取最大值（HTP）无法表达，因为比较必须发生在编码之前；
/// 而同优先级的先后完全取决于调用方的收集顺序。这里先决出胜者再编码，
/// 每个属性只编码一次。
fn merge_output_values(values: &[DmxOutputValue]) -> Vec<&DmxOutputValue> {
    let mut groups: BTreeMap<(&str, &str), Vec<&DmxOutputValue>> = BTreeMap::new();
    for value in values.iter().filter(|value| value.active) {
        groups
            .entry((value.fixture_id.as_str(), value.attribute.as_str()))
            .or_default()
            .push(value);
    }

    groups
        .into_values()
        .filter_map(|group| resolve_group(&group))
        .collect()
}

/// 决出一个 (fixture, attribute) 上的胜出值。
///
/// 先取 source 优先级最高的一层 —— programmer 抓住某个属性时就该独占它，
/// 不与回放混合。层内再看合并方式：HTP 取最大值，LTP 交给
/// (priority, order) 最大的贡献者。
fn resolve_group<'a>(group: &[&'a DmxOutputValue]) -> Option<&'a DmxOutputValue> {
    let top = group
        .iter()
        .map(|value| source_priority(value.source))
        .max()?;
    let layer = group
        .iter()
        .filter(|value| source_priority(value.source) == top);

    if group
        .iter()
        .any(|value| source_priority(value.source) == top && value.merge == DmxMergeMode::Htp)
    {
        layer
            .max_by(|left, right| {
                left.numeric
                    .unwrap_or(f64::NEG_INFINITY)
                    .total_cmp(&right.numeric.unwrap_or(f64::NEG_INFINITY))
                    .then_with(|| (left.priority, left.order).cmp(&(right.priority, right.order)))
            })
            .copied()
    } else {
        layer
            .max_by_key(|value| (value.priority, value.order))
            .copied()
    }
}

fn render_output_value(
    input: &DmxRenderInput,
    value: &DmxOutputValue,
    universes: &mut BTreeMap<u16, [u8; DMX_UNIVERSE_SIZE]>,
    sources: &mut BTreeMap<u16, [DmxChannelSource; DMX_UNIVERSE_SIZE]>,
) -> DmxResult<()> {
    let parent_id = parent_fixture_id(&value.fixture_id);
    let Some(fixture) = input
        .fixtures
        .iter()
        .find(|fixture| fixture.id == parent_id)
    else {
        return Ok(());
    };
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
    let Some(attribute) = mode.attributes.iter().find(|item| item.name == value.attribute) else {
        return Ok(());
    };
    let module_id = selected_module_id(&value.fixture_id);
    let universe_data = universes
        .entry(universe)
        .or_insert([0_u8; DMX_UNIVERSE_SIZE]);
    let universe_sources = sources
        .entry(universe)
        .or_insert([DmxChannelSource::None; DMX_UNIVERSE_SIZE]);

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
                universe_sources[index] = value.source;
            }
        }
    }

    Ok(())
}

fn render_fixture_defaults(
    input: &DmxRenderInput,
    fixture: &DmxFixturePatch,
    universes: &mut BTreeMap<u16, [u8; DMX_UNIVERSE_SIZE]>,
    sources: &mut BTreeMap<u16, [DmxChannelSource; DMX_UNIVERSE_SIZE]>,
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
    let universe_sources = sources
        .entry(universe)
        .or_insert([DmxChannelSource::None; DMX_UNIVERSE_SIZE]);

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
                    universe_sources[index] = DmxChannelSource::Default;
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

fn source_priority(source: DmxChannelSource) -> u8 {
    match source {
        DmxChannelSource::None | DmxChannelSource::Default => 0,
        DmxChannelSource::Sequence => 10,
        DmxChannelSource::Effect => 20,
        DmxChannelSource::Programmer => 30,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_parent_fixture_attribute_to_all_matching_slots() {
        let frames = render_dmx(&input("fix-1")).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data[0], 255);
        assert_eq!(frames[0].data[3], 255);
    }

    #[test]
    fn renders_sub_fixture_attribute_to_selected_module_only() {
        let frames = render_dmx(&input("fix-1::sub:module-2")).unwrap();
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
        input.output_values[0].numeric = Some(50.0);

        let frames = render_dmx(&input).unwrap();
        assert_eq!(frames[0].data[0], 128);
        assert_eq!(frames[0].data[1], 0);
    }

    #[test]
    fn renders_zero_percent_as_zero_dmx() {
        let mut input = input("fix-1");
        input.output_values[0].numeric = Some(0.0);

        let frames = render_dmx(&input).unwrap();
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
        input.output_values[0].attribute = "Pan".to_string();

        input.output_values[0].numeric = Some(32.5);
        let frames = render_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[0, 0]);

        input.output_values[0].numeric = Some(0.0);
        let frames = render_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[128, 0]);

        input.output_values[0].numeric = Some(-32.5);
        let frames = render_dmx(&input).unwrap();
        assert_eq!(&frames[0].data[0..2], &[255, 255]);
    }

    #[test]
    fn renders_fixture_defaults_without_active_output_values() {
        let mut input = input("fix-1");
        input.output_values.clear();
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[0].default_raw = Some(7.0);
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[1].default_raw = Some(9.0);

        let frames = render_dmx(&input).unwrap();

        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].data[0], 7);
        assert_eq!(frames[0].data[3], 9);
        assert_eq!(frames[0].sources[0], DmxChannelSource::Default);
        assert_eq!(frames[0].sources[3], DmxChannelSource::Default);
    }

    #[test]
    fn active_output_values_override_fixture_defaults() {
        let mut input = input("fix-1");
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[0].default_raw = Some(7.0);
        input.fixture_types[0].modes[0].attributes[0].dmx_slots[1].default_raw = Some(9.0);
        input.output_values[0].numeric = Some(100.0);

        let frames = render_dmx(&input).unwrap();

        assert_eq!(frames[0].data[0], 255);
        assert_eq!(frames[0].data[3], 255);
        assert_eq!(frames[0].sources[0], DmxChannelSource::Programmer);
        assert_eq!(frames[0].sources[3], DmxChannelSource::Programmer);
    }

    #[test]
    fn higher_priority_output_sources_override_lower_priority_sources() {
        let mut input = input("fix-1");
        input.output_values = vec![
            DmxOutputValue::simple("fix-1", "Dimmer", Some(30.0), true, DmxChannelSource::Sequence),
            DmxOutputValue::simple("fix-1", "Dimmer", Some(60.0), true, DmxChannelSource::Effect),
            DmxOutputValue::simple(
                "fix-1",
                "Dimmer",
                Some(90.0),
                true,
                DmxChannelSource::Programmer,
            ),
        ];

        let frames = render_dmx(&input).unwrap();

        assert_eq!(frames[0].data[0], 230);
        assert_eq!(frames[0].sources[0], DmxChannelSource::Programmer);
    }

    #[test]
    fn htp_merges_take_the_highest_value_within_a_layer() {
        let mut input = input("fix-1");
        input.output_values = vec![
            htp_sequence_value(30.0, 10, 1),
            htp_sequence_value(90.0, 5, 2),
            htp_sequence_value(60.0, 90, 3),
        ];

        let frames = render_dmx(&input).unwrap();

        // 优先级最高的贡献者只给到 60，但 HTP 下强度取全层最大值。
        assert_eq!(frames[0].data[0], 230);
    }

    #[test]
    fn ltp_merges_follow_priority_then_order() {
        let mut input = input("fix-1");
        input.output_values = vec![
            ltp_sequence_value(30.0, 10, 1),
            ltp_sequence_value(90.0, 5, 2),
            ltp_sequence_value(60.0, 10, 2),
        ];

        let frames = render_dmx(&input).unwrap();

        // priority 10 有两个贡献者，order 大的胜出 —— 与收集顺序无关。
        assert_eq!(frames[0].data[0], 153);
    }

    #[test]
    fn programmer_layer_excludes_lower_sources_from_htp() {
        let mut input = input("fix-1");
        input.output_values = vec![
            htp_sequence_value(100.0, 90, 1),
            DmxOutputValue {
                merge: DmxMergeMode::Htp,
                ..DmxOutputValue::simple(
                    "fix-1",
                    "Dimmer",
                    Some(20.0),
                    true,
                    DmxChannelSource::Programmer,
                )
            },
        ];

        let frames = render_dmx(&input).unwrap();

        // programmer 抓住该属性后独占，不与回放层取最大值。
        assert_eq!(frames[0].data[0], 51);
        assert_eq!(frames[0].sources[0], DmxChannelSource::Programmer);
    }

    fn htp_sequence_value(numeric: f64, priority: u8, order: u32) -> DmxOutputValue {
        DmxOutputValue {
            priority,
            order,
            merge: DmxMergeMode::Htp,
            ..DmxOutputValue::simple(
                "fix-1",
                "Dimmer",
                Some(numeric),
                true,
                DmxChannelSource::Sequence,
            )
        }
    }

    fn ltp_sequence_value(numeric: f64, priority: u8, order: u32) -> DmxOutputValue {
        DmxOutputValue {
            priority,
            order,
            merge: DmxMergeMode::Ltp,
            ..DmxOutputValue::simple(
                "fix-1",
                "Dimmer",
                Some(numeric),
                true,
                DmxChannelSource::Sequence,
            )
        }
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
            output_values: vec![DmxOutputValue::simple(
                fixture_id,
                "Dimmer",
                Some(100.0),
                true,
                DmxChannelSource::Programmer,
            )],
        }
    }
}
