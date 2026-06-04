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

pub fn read_gdtf(path: impl AsRef<Path>) -> GdtfResult<GdtfFixtureSummary> {
    let xml = read_description_xml(path)?;
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

pub fn read_description_xml(path: impl AsRef<Path>) -> GdtfResult<String> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
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

    let modes = parse_modes(fixture);
    let attribute_groups = summarize_attributes(fixture, &modes);

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

fn parse_modes(fixture: Node<'_, '_>) -> Vec<GdtfModeSummary> {
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
            let mut attributes = BTreeSet::new();

            for dmx_channel in mode
                .descendants()
                .filter(|node| node.has_tag_name("DMXChannel"))
            {
                for offset in parse_offsets(dmx_channel.attribute("Offset").unwrap_or_default()) {
                    max_channel = max_channel.max(offset);
                }

                for logical_channel in dmx_channel
                    .children()
                    .filter(|node| node.has_tag_name("LogicalChannel"))
                {
                    if let Some(attribute) = logical_channel.attribute("Attribute") {
                        attributes.insert(attribute.to_string());
                    }

                    for function in logical_channel
                        .children()
                        .filter(|node| node.has_tag_name("ChannelFunction"))
                    {
                        if let Some(attribute) = function.attribute("Attribute") {
                            attributes.insert(attribute.to_string());
                        }
                    }
                }
            }

            modes.push(GdtfModeSummary {
                id: format!("mode-{index}"),
                name: mode.attribute("Name").unwrap_or("Default").to_string(),
                channels: max_channel,
                attributes: attributes.into_iter().collect(),
            });
        }
    }

    if modes.is_empty() {
        modes.push(GdtfModeSummary {
            id: "mode-0".to_string(),
            name: "Default".to_string(),
            channels: 0,
            attributes: Vec::new(),
        });
    }

    modes
}

fn summarize_attributes(
    fixture: Node<'_, '_>,
    modes: &[GdtfModeSummary],
) -> Vec<GdtfAttributeGroupSummary> {
    let mut features_by_attribute = BTreeMap::<String, String>::new();

    if let Some(attributes) = fixture
        .descendants()
        .find(|node| node.has_tag_name("Attributes"))
    {
        for attribute in attributes
            .children()
            .filter(|node| node.has_tag_name("Attribute"))
        {
            let name = attribute.attribute("Name").unwrap_or_default();
            let feature = attribute.attribute("Feature").unwrap_or(name);
            features_by_attribute.insert(name.to_string(), feature_group_name(feature));
        }
    }

    let mut counts = BTreeMap::<String, u16>::new();
    for mode in modes {
        for attribute in &mode.attributes {
            let group = features_by_attribute
                .get(attribute)
                .cloned()
                .unwrap_or_else(|| infer_attribute_group(attribute));
            *counts.entry(group).or_insert(0) += 1;
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

fn rewrite_gdtf_archive(path: impl AsRef<Path>, description_xml: &str) -> GdtfResult<()> {
    let path = path.as_ref();
    let mut source_bytes = Vec::new();
    File::open(path)?.read_to_end(&mut source_bytes)?;
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

    std::fs::write(path, output.into_inner())?;
    Ok(())
}

fn parse_offsets(value: &str) -> Vec<u16> {
    value
        .split(',')
        .filter_map(|part| part.trim().parse::<u16>().ok())
        .collect()
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
}
