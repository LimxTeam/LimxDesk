use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::File,
    io::{Cursor, Read, Write},
    path::Path,
};
use uuid::Uuid;
use zip::{write::FileOptions, ZipArchive, ZipWriter};

pub const GDTF_EXTENSION: &str = "gdtf";
const DESCRIPTION_XML: &str = "description.xml";

#[derive(Debug)]
pub enum GdtfError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    Xml(roxmltree::Error),
    InvalidArchive(String),
}

impl fmt::Display for GdtfError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Zip(error) => write!(formatter, "{error}"),
            Self::Xml(error) => write!(formatter, "{error}"),
            Self::InvalidArchive(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for GdtfError {}

impl From<std::io::Error> for GdtfError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<zip::result::ZipError> for GdtfError {
    fn from(value: zip::result::ZipError) -> Self {
        Self::Zip(value)
    }
}

impl From<roxmltree::Error> for GdtfError {
    fn from(value: roxmltree::Error) -> Self {
        Self::Xml(value)
    }
}

pub type GdtfResult<T> = Result<T, GdtfError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfFixtureSummary {
    pub fixture_type_id: String,
    pub name: String,
    pub manufacturer: String,
    pub short_name: String,
    pub long_name: String,
    pub description: String,
    pub data_version: String,
    pub modes: Vec<GdtfModeSummary>,
    pub attribute_groups: Vec<GdtfAttributeGroupSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfModeSummary {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<String>,
    pub attribute_details: Vec<GdtfModeAttributeSummary>,
    pub sub_fixtures: Vec<GdtfModeSubFixtureSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfModeAttributeSummary {
    pub name: String,
    pub feature_group: String,
    pub occurrence_count: u16,
    pub module_ids: Vec<String>,
    pub dmx_slots: Vec<GdtfAttributeDmxSlotSummary>,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub default_value: Option<f64>,
    pub value_kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfAttributeDmxSlotSummary {
    pub module_id: Option<String>,
    pub offsets: Vec<u16>,
    pub physical_from: Option<f64>,
    pub physical_to: Option<f64>,
    pub default_raw: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfModeSubFixtureSummary {
    pub id: String,
    pub name: String,
    pub geometry: String,
    pub index: u16,
    pub first_address: Option<u16>,
    pub channel_count: u16,
    pub attributes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfAttributeGroupSummary {
    pub id: String,
    pub name: String,
    pub count: u16,
    pub encoder_page: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfFixtureDraft {
    pub name: String,
    pub manufacturer: String,
    pub short_name: String,
    pub long_name: String,
    pub description: String,
    pub modes: Vec<GdtfModeDraft>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GdtfModeDraft {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<String>,
}

#[derive(Clone, Debug)]
struct ChannelAttributeOccurrence {
    name: String,
    feature_group: String,
    geometry: String,
    offsets: Vec<u16>,
    physical_from: Option<f64>,
    physical_to: Option<f64>,
    default_raw: Option<f64>,
    default_value: Option<f64>,
}

pub fn read_gdtf(path: impl AsRef<Path>) -> GdtfResult<GdtfFixtureSummary> {
    let xml = read_description_xml(path)?;
    parse_description_xml(&xml)
}

pub fn read_gdtf_bytes(bytes: &[u8]) -> GdtfResult<GdtfFixtureSummary> {
    let xml = read_description_xml_from_bytes(bytes)?;
    parse_description_xml(&xml)
}

pub fn create_gdtf(
    path: impl AsRef<Path>,
    draft: &GdtfFixtureDraft,
) -> GdtfResult<GdtfFixtureSummary> {
    let fixture_type_id = Uuid::new_v4().to_string().to_uppercase();
    let xml = build_description_xml(&fixture_type_id, draft);
    write_gdtf_archive(path, &xml)?;
    parse_description_xml(&xml)
}

pub fn create_gdtf_bytes(draft: &GdtfFixtureDraft) -> GdtfResult<Vec<u8>> {
    let fixture_type_id = Uuid::new_v4().to_string().to_uppercase();
    let xml = build_description_xml(&fixture_type_id, draft);
    write_gdtf_archive_to_bytes(&xml)
}

pub fn update_gdtf(
    path: impl AsRef<Path>,
    draft: &GdtfFixtureDraft,
) -> GdtfResult<GdtfFixtureSummary> {
    let path = path.as_ref();
    let existing = read_description_xml(path)?;
    let existing_summary = parse_description_xml(&existing)?;
    let xml = build_description_xml(&existing_summary.fixture_type_id, draft);
    rewrite_gdtf_archive(path, &xml)?;
    parse_description_xml(&xml)
}

pub fn update_gdtf_bytes(bytes: &[u8], draft: &GdtfFixtureDraft) -> GdtfResult<Vec<u8>> {
    let existing = read_description_xml_from_bytes(bytes)?;
    let existing_summary = parse_description_xml(&existing)?;
    let xml = build_description_xml(&existing_summary.fixture_type_id, draft);
    rewrite_gdtf_archive_to_bytes(bytes, &xml)
}

pub fn read_description_xml(path: impl AsRef<Path>) -> GdtfResult<String> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    read_description_xml_from_archive(&mut archive)
}

pub fn read_description_xml_from_bytes(bytes: &[u8]) -> GdtfResult<String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    read_description_xml_from_archive(&mut archive)
}

fn read_description_xml_from_archive<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> GdtfResult<String> {
    let mut description = archive.by_name(DESCRIPTION_XML).map_err(|_| {
        GdtfError::InvalidArchive("GDTF archive has no description.xml".to_string())
    })?;
    let mut xml = String::new();
    description.read_to_string(&mut xml)?;
    if xml.ends_with('\0') {
        xml.pop();
    }
    Ok(xml)
}

pub fn parse_description_xml(xml: &str) -> GdtfResult<GdtfFixtureSummary> {
    let document = Document::parse(xml)?;
    let root = document
        .descendants()
        .find(|node| node.has_tag_name("GDTF"))
        .ok_or_else(|| GdtfError::InvalidArchive("description.xml has no GDTF root".to_string()))?;
    let fixture = root
        .children()
        .find(|node| node.has_tag_name("FixtureType"))
        .ok_or_else(|| {
            GdtfError::InvalidArchive("description.xml has no FixtureType".to_string())
        })?;

    let features_by_attribute = attribute_feature_map(fixture);
    let modes = parse_modes(fixture, &features_by_attribute);
    let attribute_groups = summarize_attributes(&modes);

    Ok(GdtfFixtureSummary {
        fixture_type_id: fixture
            .attribute("FixtureTypeID")
            .unwrap_or_default()
            .to_string(),
        name: fixture
            .attribute("Name")
            .unwrap_or("Unnamed Fixture")
            .to_string(),
        manufacturer: fixture
            .attribute("Manufacturer")
            .unwrap_or("Unknown")
            .to_string(),
        short_name: fixture
            .attribute("ShortName")
            .unwrap_or_default()
            .to_string(),
        long_name: fixture
            .attribute("LongName")
            .unwrap_or_default()
            .to_string(),
        description: fixture
            .attribute("Description")
            .unwrap_or_default()
            .to_string(),
        data_version: root.attribute("DataVersion").unwrap_or("1.2").to_string(),
        modes,
        attribute_groups,
    })
}

fn parse_modes(
    fixture: Node<'_, '_>,
    features_by_attribute: &BTreeMap<String, String>,
) -> Vec<GdtfModeSummary> {
    let mut modes = Vec::new();
    if let Some(dmx_modes) = fixture
        .children()
        .find(|node| node.has_tag_name("DMXModes"))
    {
        for (index, mode) in dmx_modes
            .children()
            .filter(|node| node.has_tag_name("DMXMode"))
            .enumerate()
        {
            let mut max_channel = 0_u16;
            let mut occurrences = Vec::new();

            for dmx_channel in mode
                .descendants()
                .filter(|node| node.has_tag_name("DMXChannel"))
            {
                let offsets = parse_offsets(dmx_channel.attribute("Offset").unwrap_or_default());
                for offset in &offsets {
                    max_channel = max_channel.max(*offset);
                }

                if let Some(channel) = channel_attribute_occurrence(dmx_channel) {
                    let attribute = channel.name;
                    let default_value = channel.default_value.or_else(|| {
                        channel.default_raw.and_then(|raw| {
                            raw_dmx_to_physical(
                                raw,
                                offsets.len(),
                                channel.physical_from,
                                channel.physical_to,
                            )
                        })
                    });
                    let feature_group = features_by_attribute
                        .get(&attribute)
                        .cloned()
                        .unwrap_or_else(|| infer_attribute_group(&attribute));
                    occurrences.push(ChannelAttributeOccurrence {
                        name: attribute,
                        feature_group,
                        geometry: dmx_channel
                            .attribute("Geometry")
                            .unwrap_or_default()
                            .to_string(),
                        offsets,
                        physical_from: channel.physical_from,
                        physical_to: channel.physical_to,
                        default_raw: channel.default_raw,
                        default_value,
                    });
                }
            }

            let sub_fixtures = infer_sub_fixtures(&occurrences);
            let attributes = summarize_mode_attributes(&occurrences, &sub_fixtures);
            let attribute_names = attributes
                .iter()
                .map(|attribute| attribute.name.clone())
                .collect();
            modes.push(GdtfModeSummary {
                id: format!("mode-{index}"),
                name: mode.attribute("Name").unwrap_or("Default").to_string(),
                channels: max_channel,
                attributes: attribute_names,
                attribute_details: attributes,
                sub_fixtures,
            });
        }
    }

    if modes.is_empty() {
        modes.push(GdtfModeSummary {
            id: "mode-0".to_string(),
            name: "Default".to_string(),
            channels: 0,
            attributes: Vec::new(),
            attribute_details: Vec::new(),
            sub_fixtures: Vec::new(),
        });
    }

    modes
}

fn channel_attribute_occurrence(dmx_channel: Node<'_, '_>) -> Option<ChannelAttributeOccurrence> {
    for logical_channel in dmx_channel
        .children()
        .filter(|node| node.has_tag_name("LogicalChannel"))
    {
        if let Some(attribute) = normalize_attribute_link(logical_channel.attribute("Attribute")) {
            let function = logical_channel
                .children()
                .find(|node| node.has_tag_name("ChannelFunction"));
            return Some(ChannelAttributeOccurrence {
                name: attribute,
                feature_group: String::new(),
                geometry: String::new(),
                offsets: Vec::new(),
                physical_from: function.and_then(|node| parse_f64(node.attribute("PhysicalFrom"))),
                physical_to: function.and_then(|node| parse_f64(node.attribute("PhysicalTo"))),
                default_raw: function
                    .and_then(|node| parse_gdtf_raw_number(node.attribute("Default")))
                    .or_else(|| parse_gdtf_raw_number(dmx_channel.attribute("Default"))),
                default_value: None,
            });
        }

        for function in logical_channel
            .children()
            .filter(|node| node.has_tag_name("ChannelFunction"))
        {
            if let Some(attribute) = normalize_attribute_link(function.attribute("Attribute")) {
                return Some(ChannelAttributeOccurrence {
                    name: attribute,
                    feature_group: String::new(),
                    geometry: String::new(),
                    offsets: Vec::new(),
                    physical_from: parse_f64(function.attribute("PhysicalFrom")),
                    physical_to: parse_f64(function.attribute("PhysicalTo")),
                    default_raw: parse_gdtf_raw_number(function.attribute("Default"))
                        .or_else(|| parse_gdtf_raw_number(dmx_channel.attribute("Default"))),
                    default_value: None,
                });
            }
            if let Some(attribute) =
                normalize_attribute_link(function.attribute("OriginalAttribute"))
            {
                return Some(ChannelAttributeOccurrence {
                    name: attribute,
                    feature_group: String::new(),
                    geometry: String::new(),
                    offsets: Vec::new(),
                    physical_from: parse_f64(function.attribute("PhysicalFrom")),
                    physical_to: parse_f64(function.attribute("PhysicalTo")),
                    default_raw: parse_gdtf_raw_number(function.attribute("Default"))
                        .or_else(|| parse_gdtf_raw_number(dmx_channel.attribute("Default"))),
                    default_value: None,
                });
            }
        }
    }

    attribute_from_initial_function(dmx_channel.attribute("InitialFunction")).map(|attribute| {
        ChannelAttributeOccurrence {
            name: attribute,
            feature_group: String::new(),
            geometry: String::new(),
            offsets: Vec::new(),
            physical_from: None,
            physical_to: None,
            default_raw: parse_gdtf_raw_number(dmx_channel.attribute("Default")),
            default_value: None,
        }
    })
}

fn summarize_mode_attributes(
    occurrences: &[ChannelAttributeOccurrence],
    sub_fixtures: &[GdtfModeSubFixtureSummary],
) -> Vec<GdtfModeAttributeSummary> {
    let mut attributes = Vec::new();
    let mut seen = BTreeSet::new();

    for occurrence in occurrences {
        if !seen.insert(occurrence.name.clone()) {
            continue;
        }

        let module_ids = sub_fixtures
            .iter()
            .filter(|module| {
                module
                    .attributes
                    .iter()
                    .any(|item| item == &occurrence.name)
            })
            .map(|module| module.id.clone())
            .collect::<Vec<_>>();
        let matching = occurrences
            .iter()
            .filter(|item| item.name == occurrence.name)
            .collect::<Vec<_>>();
        let dmx_slots = matching
            .iter()
            .map(|item| GdtfAttributeDmxSlotSummary {
                module_id: module_for_occurrence(item, sub_fixtures),
                offsets: item.offsets.clone(),
                physical_from: item.physical_from,
                physical_to: item.physical_to,
                default_raw: item.default_raw,
            })
            .collect::<Vec<_>>();
        let occurrence_count = matching.len().min(u16::MAX as usize) as u16;
        let physical_values = matching
            .iter()
            .flat_map(|item| [item.physical_from, item.physical_to])
            .flatten()
            .collect::<Vec<_>>();
        let min_value = physical_values.iter().copied().reduce(f64::min);
        let max_value = physical_values.iter().copied().reduce(f64::max);
        let default_value = matching.iter().find_map(|item| item.default_value);
        let value_kind = infer_value_kind(
            &occurrence.name,
            &occurrence.feature_group,
            min_value,
            max_value,
        );

        attributes.push(GdtfModeAttributeSummary {
            name: occurrence.name.clone(),
            feature_group: occurrence.feature_group.clone(),
            occurrence_count,
            module_ids,
            dmx_slots,
            min_value,
            max_value,
            default_value,
            value_kind,
        });
    }

    attributes
}

fn module_for_occurrence(
    occurrence: &ChannelAttributeOccurrence,
    sub_fixtures: &[GdtfModeSubFixtureSummary],
) -> Option<String> {
    let first_offset = occurrence.offsets.iter().copied().min()?;
    sub_fixtures
        .iter()
        .find(|module| {
            let Some(first_address) = module.first_address else {
                return false;
            };
            let last_address = first_address.saturating_add(module.channel_count.saturating_sub(1));
            first_offset >= first_address && first_offset <= last_address
        })
        .map(|module| module.id.clone())
}

fn infer_sub_fixtures(
    occurrences: &[ChannelAttributeOccurrence],
) -> Vec<GdtfModeSubFixtureSummary> {
    if occurrences.is_empty() {
        return Vec::new();
    }

    let mut geometry_order = Vec::<String>::new();
    for occurrence in occurrences {
        let geometry = occurrence.geometry.trim();
        if !geometry.is_empty() && !geometry_order.iter().any(|item| item == geometry) {
            geometry_order.push(geometry.to_string());
        }
    }

    if geometry_order.len() > 1 {
        return geometry_order
            .into_iter()
            .enumerate()
            .map(|(index, geometry)| {
                let group = occurrences
                    .iter()
                    .filter(|occurrence| occurrence.geometry == geometry)
                    .cloned()
                    .collect::<Vec<_>>();
                sub_fixture_from_occurrences(index, &geometry, &geometry, &group)
            })
            .collect();
    }

    let anchor = occurrences
        .iter()
        .find(|candidate| {
            occurrences
                .iter()
                .filter(|occurrence| occurrence.name == candidate.name)
                .count()
                > 1
        })
        .map(|occurrence| occurrence.name.clone());
    let Some(anchor) = anchor else {
        return Vec::new();
    };

    let starts = occurrences
        .iter()
        .enumerate()
        .filter_map(|(index, occurrence)| (occurrence.name == anchor).then_some(index))
        .collect::<Vec<_>>();
    if starts.len() <= 1 {
        return Vec::new();
    }

    starts
        .iter()
        .enumerate()
        .map(|(module_index, start)| {
            let end = starts
                .get(module_index + 1)
                .copied()
                .unwrap_or(occurrences.len());
            let group = &occurrences[*start..end];
            sub_fixture_from_occurrences(
                module_index,
                &format!("Module {}", module_index + 1),
                group
                    .first()
                    .map(|occurrence| occurrence.geometry.as_str())
                    .unwrap_or_default(),
                group,
            )
        })
        .collect()
}

fn sub_fixture_from_occurrences(
    zero_based_index: usize,
    name: &str,
    geometry: &str,
    occurrences: &[ChannelAttributeOccurrence],
) -> GdtfModeSubFixtureSummary {
    let mut seen = BTreeSet::new();
    let attributes = occurrences
        .iter()
        .filter_map(|occurrence| {
            if seen.insert(occurrence.name.clone()) {
                Some(occurrence.name.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let first_address = occurrences
        .iter()
        .flat_map(|occurrence| occurrence.offsets.iter().copied())
        .min();
    let max_address = occurrences
        .iter()
        .flat_map(|occurrence| occurrence.offsets.iter().copied())
        .max();
    let channel_count = first_address
        .zip(max_address)
        .map(|(first, last)| last.saturating_sub(first).saturating_add(1))
        .unwrap_or_else(|| occurrences.len().min(u16::MAX as usize) as u16);

    GdtfModeSubFixtureSummary {
        id: format!("module-{}", zero_based_index + 1),
        name: name.to_string(),
        geometry: geometry.to_string(),
        index: (zero_based_index + 1).min(u16::MAX as usize) as u16,
        first_address,
        channel_count,
        attributes,
    }
}

fn summarize_attributes(modes: &[GdtfModeSummary]) -> Vec<GdtfAttributeGroupSummary> {
    let mut counts = BTreeMap::<String, u16>::new();
    for mode in modes {
        for attribute in &mode.attribute_details {
            *counts.entry(attribute.feature_group.clone()).or_insert(0) += 1;
        }
    }

    if counts.is_empty() {
        counts.insert("Control".to_string(), 0);
    }

    counts
        .into_iter()
        .map(|(name, count)| {
            let pages = ((count.max(1) as f32) / 4.0).ceil() as u16;
            GdtfAttributeGroupSummary {
                id: slug(&name),
                name: name.clone(),
                count,
                encoder_page: format!("{name} 1 of {}", pages.max(1)),
            }
        })
        .collect()
}

fn attribute_feature_map(fixture: Node<'_, '_>) -> BTreeMap<String, String> {
    let mut features_by_attribute = BTreeMap::<String, String>::new();

    if let Some(attributes) = fixture
        .descendants()
        .find(|node| node.has_tag_name("Attributes"))
    {
        for attribute in attributes
            .children()
            .filter(|node| node.has_tag_name("Attribute"))
        {
            let Some(name) = normalize_attribute_link(attribute.attribute("Name")) else {
                continue;
            };
            let feature = attribute
                .attribute("Feature")
                .map(feature_group_name)
                .unwrap_or_else(|| infer_attribute_group(&name));
            features_by_attribute.insert(name, feature);
        }
    }

    features_by_attribute
}

fn build_description_xml(fixture_type_id: &str, draft: &GdtfFixtureDraft) -> String {
    let modes = if draft.modes.is_empty() {
        vec![GdtfModeDraft {
            id: "default".to_string(),
            name: "Default".to_string(),
            channels: 1,
            attributes: vec!["Dimmer".to_string()],
        }]
    } else {
        draft.modes.clone()
    };

    let mut attribute_set = BTreeSet::<String>::new();
    for mode in &modes {
        for attribute in &mode.attributes {
            attribute_set.insert(clean_attribute(attribute));
        }
    }
    if attribute_set.is_empty() {
        attribute_set.insert("Dimmer".to_string());
    }

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<GDTF DataVersion=\"1.2\">\n");
    xml.push_str(&format!(
        "  <FixtureType CanHaveChildren=\"No\" Description=\"{}\" FixtureTypeID=\"{}\" LongName=\"{}\" Manufacturer=\"{}\" Name=\"{}\" RefFT=\"\" ShortName=\"{}\" Thumbnail=\"\" ThumbnailOffsetX=\"0\" ThumbnailOffsetY=\"0\">\n",
        escape_xml(&draft.description),
        escape_xml(fixture_type_id),
        escape_xml(default_if_empty(&draft.long_name, &draft.name)),
        escape_xml(default_if_empty(&draft.manufacturer, "Custom")),
        escape_xml(default_if_empty(&draft.name, "New Fixture Type")),
        escape_xml(default_if_empty(&draft.short_name, &draft.name)),
    ));

    xml.push_str("    <AttributeDefinitions>\n");
    xml.push_str("      <ActivationGroups/>\n");
    xml.push_str("      <FeatureGroups>\n");
    for group in groups_for_attributes(attribute_set.iter()) {
        xml.push_str(&format!(
            "        <FeatureGroup Name=\"{}\" Pretty=\"{}\"><Feature Name=\"{}\"/></FeatureGroup>\n",
            escape_xml(&group),
            escape_xml(&group),
            escape_xml(&group),
        ));
    }
    xml.push_str("      </FeatureGroups>\n");
    xml.push_str("      <Attributes>\n");
    for attribute in &attribute_set {
        let group = infer_attribute_group(attribute);
        xml.push_str(&format!(
            "        <Attribute Feature=\"{}.{}\" Name=\"{}\" PhysicalUnit=\"None\" Pretty=\"{}\"/>\n",
            escape_xml(&group),
            escape_xml(&group),
            escape_xml(attribute),
            escape_xml(attribute),
        ));
    }
    xml.push_str("      </Attributes>\n");
    xml.push_str("    </AttributeDefinitions>\n");
    xml.push_str("    <Wheels/>\n");
    xml.push_str("    <PhysicalDescriptions><ColorSpace Mode=\"sRGB\" Name=\"\"/><AdditionalColorSpaces/><Gamuts/><Filters/><Emitters/><DMXProfiles/><CRIs/><Connectors/><Properties/></PhysicalDescriptions>\n");
    xml.push_str("    <Models><Model File=\"Base\" Height=\"0.000000\" Length=\"0.000000\" Name=\"Base\" PrimitiveType=\"Undefined\" SVGFrontOffsetX=\"0.000000\" SVGFrontOffsetY=\"0.000000\" SVGOffsetX=\"0.000000\" SVGOffsetY=\"0.000000\" SVGSideOffsetX=\"0.000000\" SVGSideOffsetY=\"0.000000\" Width=\"0.000000\"/></Models>\n");
    xml.push_str("    <Geometries><Geometry Model=\"Base\" Name=\"Base\"/></Geometries>\n");
    xml.push_str("    <DMXModes>\n");
    for mode in modes {
        let attributes = if mode.attributes.is_empty() {
            vec!["Dimmer".to_string()]
        } else {
            mode.attributes
                .into_iter()
                .map(|value| clean_attribute(&value))
                .collect()
        };
        let channels = mode.channels.max(1);
        xml.push_str(&format!(
            "      <DMXMode Description=\"\" Geometry=\"Base\" Name=\"{}\">\n",
            escape_xml(default_if_empty(&mode.name, "Default")),
        ));
        xml.push_str("        <DMXChannels>\n");
        for channel in 1..=channels {
            let attribute = &attributes[(channel as usize - 1) % attributes.len()];
            xml.push_str(&format!(
                "          <DMXChannel DMXBreak=\"1\" Geometry=\"Base\" InitialFunction=\"Base_{}.{}.{}\" Offset=\"{}\">\n",
                escape_xml(attribute),
                escape_xml(attribute),
                escape_xml(attribute),
                channel,
            ));
            xml.push_str(&format!(
                "            <LogicalChannel Attribute=\"{}\" Master=\"None\" Snap=\"No\"><ChannelFunction Attribute=\"{}\" DMXFrom=\"0/1\" Default=\"0/1\" Name=\"{}\" PhysicalFrom=\"0.000000\" PhysicalTo=\"1.000000\" RealAcceleration=\"0.000000\" RealFade=\"0.000000\"/></LogicalChannel>\n",
                escape_xml(attribute),
                escape_xml(attribute),
                escape_xml(attribute),
            ));
            xml.push_str("          </DMXChannel>\n");
        }
        xml.push_str("        </DMXChannels>\n");
        xml.push_str("        <Relations/>\n");
        xml.push_str("        <FTMacros/>\n");
        xml.push_str("      </DMXMode>\n");
    }
    xml.push_str("    </DMXModes>\n");
    xml.push_str("    <Revisions/>\n");
    xml.push_str("    <FTPresets/>\n");
    xml.push_str("    <Protocols/>\n");
    xml.push_str("  </FixtureType>\n");
    xml.push_str("</GDTF>\n");
    xml
}

fn write_gdtf_archive(path: impl AsRef<Path>, description_xml: &str) -> GdtfResult<()> {
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    writer.start_file(DESCRIPTION_XML, FileOptions::default())?;
    writer.write_all(description_xml.as_bytes())?;
    writer.finish()?;
    Ok(())
}

fn write_gdtf_archive_to_bytes(description_xml: &str) -> GdtfResult<Vec<u8>> {
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        writer.start_file(DESCRIPTION_XML, FileOptions::default())?;
        writer.write_all(description_xml.as_bytes())?;
        writer.finish()?;
    }
    Ok(output.into_inner())
}

fn rewrite_gdtf_archive(path: impl AsRef<Path>, description_xml: &str) -> GdtfResult<()> {
    let path = path.as_ref();
    let mut source_bytes = Vec::new();
    File::open(path)?.read_to_end(&mut source_bytes)?;
    let bytes = rewrite_gdtf_archive_to_bytes(&source_bytes, description_xml)?;
    std::fs::write(path, bytes)?;
    Ok(())
}

fn rewrite_gdtf_archive_to_bytes(
    source_bytes: &[u8],
    description_xml: &str,
) -> GdtfResult<Vec<u8>> {
    let mut source = ZipArchive::new(Cursor::new(source_bytes))?;
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut output);
        writer.start_file(DESCRIPTION_XML, FileOptions::default())?;
        writer.write_all(description_xml.as_bytes())?;

        for index in 0..source.len() {
            let mut file = source.by_index(index)?;
            let name = file.name().to_string();
            if name == DESCRIPTION_XML {
                continue;
            }
            writer.start_file(name, FileOptions::default())?;
            std::io::copy(&mut file, &mut writer)?;
        }
        writer.finish()?;
    }

    Ok(output.into_inner())
}

fn parse_offsets(value: &str) -> Vec<u16> {
    value
        .split(',')
        .filter_map(|part| part.trim().parse::<u16>().ok())
        .collect()
}

fn parse_f64(value: Option<&str>) -> Option<f64> {
    value?.trim().parse::<f64>().ok()
}

fn parse_gdtf_raw_number(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    if let Some((left, right)) = value.split_once('/') {
        let numerator = left.trim().parse::<f64>().ok()?;
        let _resolution = right.trim().parse::<u8>().ok()?;
        return Some(numerator);
    }

    value.parse::<f64>().ok()
}

fn raw_dmx_to_physical(
    raw: f64,
    resolution_bytes: usize,
    physical_from: Option<f64>,
    physical_to: Option<f64>,
) -> Option<f64> {
    let (Some(from), Some(to)) = (physical_from, physical_to) else {
        return Some(raw);
    };
    let max = dmx_raw_max(resolution_bytes)?;
    if max <= 0.0 {
        return Some(from);
    }
    let normalized = (raw / max).clamp(0.0, 1.0);
    Some(from + (to - from) * normalized)
}

fn dmx_raw_max(resolution_bytes: usize) -> Option<f64> {
    let bytes = resolution_bytes.clamp(1, 4);
    let bits = bytes.checked_mul(8)?;
    let value = (1_u64.checked_shl(bits as u32)?).saturating_sub(1);
    Some(value as f64)
}

fn normalize_attribute_link(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("NoFeature")
        || value.eq_ignore_ascii_case("None")
    {
        return None;
    }

    let leaf = value
        .split(['.', '/'])
        .filter(|part| !part.trim().is_empty())
        .last()
        .unwrap_or(value)
        .trim();
    if leaf.is_empty()
        || leaf.eq_ignore_ascii_case("NoFeature")
        || leaf.eq_ignore_ascii_case("None")
    {
        None
    } else {
        Some(leaf.to_string())
    }
}

fn attribute_from_initial_function(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("None") {
        return None;
    }

    value
        .split('.')
        .rev()
        .find_map(|part| normalize_attribute_link(Some(part)))
}

fn feature_group_name(feature: &str) -> String {
    feature.split('.').next().unwrap_or(feature).to_string()
}

fn infer_attribute_group(attribute: &str) -> String {
    let lower = attribute.to_lowercase();
    if lower.contains("pan") || lower.contains("tilt") || lower.contains("position") {
        "Position".to_string()
    } else if lower.contains("color") || lower.contains("colour") || lower.contains("rgb") {
        "Color".to_string()
    } else if lower.contains("gobo") {
        "Gobo".to_string()
    } else if lower.contains("beam")
        || lower.contains("prism")
        || lower.contains("frost")
        || lower.contains("focus")
        || lower.contains("zoom")
    {
        "Beam".to_string()
    } else if lower.contains("dim") || lower.contains("shutter") || lower.contains("strobe") {
        "Dimmer".to_string()
    } else {
        "Control".to_string()
    }
}

fn infer_value_kind(
    attribute: &str,
    feature_group: &str,
    min_value: Option<f64>,
    max_value: Option<f64>,
) -> String {
    let lower_attribute = attribute.to_lowercase();
    let lower_group = feature_group.to_lowercase();
    if lower_attribute.contains("pan")
        || lower_attribute.contains("tilt")
        || lower_attribute.contains("rotate")
        || lower_attribute.contains("rot")
    {
        return "angle".to_string();
    }

    if matches!(lower_group.as_str(), "dimmer" | "color" | "colour") {
        return "percent".to_string();
    }

    if let (Some(min), Some(max)) = (min_value, max_value) {
        if min >= 0.0 && max <= 1.0 {
            return "percent".to_string();
        }
    }

    "range".to_string()
}

fn groups_for_attributes<'a>(attributes: impl Iterator<Item = &'a String>) -> BTreeSet<String> {
    attributes
        .map(|attribute| infer_attribute_group(attribute))
        .collect()
}

fn clean_attribute(value: &str) -> String {
    let cleaned: String = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();
    default_if_empty(&cleaned, "Dimmer").to_string()
}

fn slug(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn default_if_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fixture_summary_from_description_xml() {
        let xml = build_description_xml(
            "11111111-1111-1111-1111-111111111111",
            &GdtfFixtureDraft {
                name: "Test Fixture".to_string(),
                manufacturer: "LimxDesk".to_string(),
                short_name: "TF".to_string(),
                long_name: "Test Fixture".to_string(),
                description: "Fixture".to_string(),
                modes: vec![GdtfModeDraft {
                    id: "basic".to_string(),
                    name: "Basic".to_string(),
                    channels: 5,
                    attributes: vec!["Dimmer".to_string(), "ColorAdd_R".to_string()],
                }],
            },
        );

        let summary = parse_description_xml(&xml).unwrap();
        assert_eq!(summary.name, "Test Fixture");
        assert_eq!(summary.modes[0].channels, 5);
        assert!(summary
            .attribute_groups
            .iter()
            .any(|group| group.name == "Color"));
    }

    #[test]
    fn normalizes_gdtf_attribute_node_links() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType FixtureTypeID="111" Manufacturer="Test" Name="Moving">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Feature="Dimmer.Dimmer" Name="Dimmer"/>
        <Attribute Feature="Color.RGB" Name="ColorAdd_R"/>
      </Attributes>
    </AttributeDefinitions>
    <DMXModes>
      <DMXMode Name="Default">
        <DMXChannels>
          <DMXChannel Offset="1" InitialFunction="Beam_Dimmer.Dimmer.Dimmer">
            <LogicalChannel Attribute="Attributes.Dimmer">
              <ChannelFunction Attribute="Attributes.Dimmer" PhysicalFrom="0" PhysicalTo="1"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="2" InitialFunction="Beam_ColorAdd_R.ColorAdd_R.ColorAdd_R">
            <LogicalChannel Attribute="Attributes.ColorAdd_R">
              <ChannelFunction Attribute="Attributes.ColorAdd_R" PhysicalFrom="0" PhysicalTo="1"/>
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>"#;

        let summary = parse_description_xml(xml).unwrap();
        assert_eq!(summary.modes[0].attributes, vec!["Dimmer", "ColorAdd_R"]);
        assert_eq!(
            summary.modes[0].attribute_details[0].feature_group,
            "Dimmer"
        );
        assert_eq!(summary.modes[0].attribute_details[1].feature_group, "Color");
        assert_eq!(summary.modes[0].attribute_details[0].min_value, Some(0.0));
        assert_eq!(summary.modes[0].attribute_details[0].max_value, Some(1.0));
        assert_eq!(summary.modes[0].attribute_details[0].value_kind, "percent");
        assert!(summary
            .attribute_groups
            .iter()
            .any(|group| group.name == "Dimmer"));
    }

    #[test]
    fn merges_repeated_matrix_attributes_and_infers_sub_fixtures() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType FixtureTypeID="222" Manufacturer="Test" Name="Matrix">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Feature="Dimmer.Dimmer" Name="Dimmer"/>
        <Attribute Feature="Color.Color" Name="ColorAdd_R"/>
        <Attribute Feature="Color.Color" Name="ColorAdd_G"/>
      </Attributes>
    </AttributeDefinitions>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Body">
        <DMXChannels>
          <DMXChannel Geometry="Body" Offset="1"><LogicalChannel Attribute="Dimmer"/></DMXChannel>
          <DMXChannel Geometry="Body" Offset="2"><LogicalChannel Attribute="ColorAdd_R"/></DMXChannel>
          <DMXChannel Geometry="Body" Offset="3"><LogicalChannel Attribute="ColorAdd_G"/></DMXChannel>
          <DMXChannel Geometry="Body" Offset="4"><LogicalChannel Attribute="Dimmer"/></DMXChannel>
          <DMXChannel Geometry="Body" Offset="5"><LogicalChannel Attribute="ColorAdd_R"/></DMXChannel>
          <DMXChannel Geometry="Body" Offset="6"><LogicalChannel Attribute="ColorAdd_G"/></DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>"#;

        let summary = parse_description_xml(xml).unwrap();
        let mode = &summary.modes[0];
        assert_eq!(mode.attributes, vec!["Dimmer", "ColorAdd_R", "ColorAdd_G"]);
        assert_eq!(mode.attribute_details[0].occurrence_count, 2);
        assert_eq!(
            mode.attribute_details[0].module_ids,
            vec!["module-1", "module-2"]
        );
        assert_eq!(mode.sub_fixtures.len(), 2);
        assert_eq!(mode.sub_fixtures[0].index, 1);
        assert_eq!(mode.sub_fixtures[0].first_address, Some(1));
        assert_eq!(mode.sub_fixtures[1].index, 2);
        assert_eq!(mode.sub_fixtures[1].first_address, Some(4));
    }

    #[test]
    fn preserves_directional_sixteen_bit_slot_and_raw_default() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType FixtureTypeID="333" Manufacturer="Test" Name="Mover">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Feature="Position.PanTilt" Name="Pan"/>
      </Attributes>
    </AttributeDefinitions>
    <DMXModes>
      <DMXMode Name="Default">
        <DMXChannels>
          <DMXChannel Name="Pan" Geometry="Body" Offset="1,2" DMXBreak="1" Default="32768/2">
            <LogicalChannel Attribute="Pan">
              <ChannelFunction Name="Pan" Attribute="Pan" DMXFrom="0/2" PhysicalFrom="32.5" PhysicalTo="-32.5" />
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>"#;

        let summary = parse_description_xml(xml).unwrap();
        let attribute = &summary.modes[0].attribute_details[0];
        assert_eq!(attribute.value_kind, "angle");
        assert!(attribute.default_value.unwrap().abs() < 0.01);
        assert_eq!(attribute.dmx_slots[0].offsets, vec![1, 2]);
        assert_eq!(attribute.dmx_slots[0].physical_from, Some(32.5));
        assert_eq!(attribute.dmx_slots[0].physical_to, Some(-32.5));
    }

    #[test]
    fn creates_and_updates_gdtf_from_memory() {
        let draft = GdtfFixtureDraft {
            name: "Memory Fixture".to_string(),
            manufacturer: "LimxDesk".to_string(),
            short_name: "MEM".to_string(),
            long_name: "Memory Fixture".to_string(),
            description: "Fixture".to_string(),
            modes: vec![GdtfModeDraft {
                id: "basic".to_string(),
                name: "Basic".to_string(),
                channels: 3,
                attributes: vec!["Dimmer".to_string()],
            }],
        };

        let bytes = create_gdtf_bytes(&draft).unwrap();
        let summary = read_gdtf_bytes(&bytes).unwrap();
        assert_eq!(summary.name, "Memory Fixture");

        let updated = update_gdtf_bytes(
            &bytes,
            &GdtfFixtureDraft {
                name: "Memory Fixture Edited".to_string(),
                ..draft
            },
        )
        .unwrap();
        let summary = read_gdtf_bytes(&updated).unwrap();
        assert_eq!(summary.name, "Memory Fixture Edited");
    }
}
