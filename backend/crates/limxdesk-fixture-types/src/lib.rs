use limxdesk_gdtf::{
    create_gdtf, create_gdtf_bytes as create_gdtf_archive_bytes, read_gdtf, read_gdtf_bytes,
    update_gdtf, update_gdtf_bytes as update_gdtf_archive_bytes, GdtfError, GdtfFixtureDraft,
    GdtfFixtureSummary, GdtfModeAttributeSummary, GDTF_EXTENSION,
};
use limxdesk_platform::{LocalFileSystem, PlatformError, PlatformPaths};
use serde::{Deserialize, Serialize};
use std::{ffi::OsStr, fmt, fs, path::Path};
use uuid::Uuid;

#[derive(Debug)]
pub enum FixtureTypeError {
    Platform(PlatformError),
    Gdtf(GdtfError),
    InvalidPath(String),
    InvalidName(String),
}

impl fmt::Display for FixtureTypeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Platform(error) => write!(formatter, "{error}"),
            Self::Gdtf(error) => write!(formatter, "{error}"),
            Self::InvalidPath(message) | Self::InvalidName(message) => {
                write!(formatter, "{message}")
            }
        }
    }
}

impl std::error::Error for FixtureTypeError {}

impl From<PlatformError> for FixtureTypeError {
    fn from(value: PlatformError) -> Self {
        Self::Platform(value)
    }
}

impl From<GdtfError> for FixtureTypeError {
    fn from(value: GdtfError) -> Self {
        Self::Gdtf(value)
    }
}

pub type FixtureTypeResult<T> = Result<T, FixtureTypeError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureTypeDraft {
    pub name: String,
    pub manufacturer: String,
    pub short_name: String,
    pub long_name: String,
    pub description: String,
    pub modes: Vec<FixtureModeDraft>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureModeDraft {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureTypeEntry {
    pub id: String,
    pub name: String,
    pub manufacturer: String,
    pub short_name: String,
    pub long_name: String,
    pub description: String,
    pub source: FixtureTypeSource,
    pub used: u16,
    pub locked: bool,
    pub path: String,
    pub size_bytes: u64,
    pub modes: Vec<FixtureModeEntry>,
    pub attributes: Vec<FixtureAttributeGroupEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureModeEntry {
    pub id: String,
    pub name: String,
    pub channels: u16,
    pub attributes: Vec<String>,
    pub attribute_details: Vec<FixtureModeAttributeEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureModeAttributeEntry {
    pub name: String,
    pub feature_group: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureAttributeGroupEntry {
    pub id: String,
    pub name: String,
    pub count: u16,
    pub encoder_page: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum FixtureTypeSource {
    Gdtf,
    Custom,
    Show,
    BuiltIn,
}

#[derive(Clone, Debug)]
pub struct FixtureTypeRepository {
    paths: PlatformPaths,
    fs: LocalFileSystem,
}

impl FixtureTypeRepository {
    pub fn new(paths: PlatformPaths) -> Self {
        Self {
            paths,
            fs: LocalFileSystem,
        }
    }

    pub fn default_for_current_os() -> Self {
        Self::new(PlatformPaths::for_current_os())
    }

    pub fn gdtf_root(&self) -> &Path {
        &self.paths.gdtf_root
    }

    pub fn ensure_library(&self) -> FixtureTypeResult<()> {
        self.paths.ensure_base_layout()?;
        Ok(())
    }

    pub fn list(&self) -> FixtureTypeResult<Vec<FixtureTypeEntry>> {
        self.ensure_library()?;

        let mut entries = Vec::new();
        for path in self
            .fs
            .list_files_with_extension(&self.paths.gdtf_root, GDTF_EXTENSION)?
        {
            entries.push(self.entry_from_path(&path)?);
        }

        entries.sort_by(|left, right| {
            left.manufacturer
                .cmp(&right.manufacturer)
                .then(left.name.cmp(&right.name))
        });
        Ok(entries)
    }

    pub fn import_gdtf(
        &self,
        source_path: impl AsRef<Path>,
    ) -> FixtureTypeResult<FixtureTypeEntry> {
        self.ensure_library()?;
        let source_path = source_path.as_ref();
        validate_gdtf_extension(source_path)?;

        let summary = read_gdtf(source_path)?;
        let filename = self.unique_filename(&summary.manufacturer, &summary.name);
        let destination = self.paths.gdtf_root.join(filename);
        self.fs.copy_file(source_path, &destination)?;
        self.entry_from_path(&destination)
    }

    pub fn create(&self, draft: FixtureTypeDraft) -> FixtureTypeResult<FixtureTypeEntry> {
        self.ensure_library()?;
        validate_fixture_name(&draft.name)?;
        let filename = self.unique_filename(&draft.manufacturer, &draft.name);
        let path = self.paths.gdtf_root.join(filename);
        create_gdtf(&path, &draft.into())?;
        self.entry_from_path(&path)
    }

    pub fn update(
        &self,
        path: impl AsRef<Path>,
        draft: FixtureTypeDraft,
    ) -> FixtureTypeResult<FixtureTypeEntry> {
        self.ensure_library()?;
        validate_fixture_name(&draft.name)?;
        let path = path.as_ref();
        self.validate_library_path(path)?;
        update_gdtf(path, &draft.into())?;
        self.entry_from_path(path)
    }

    pub fn delete(&self, path: impl AsRef<Path>) -> FixtureTypeResult<()> {
        self.ensure_library()?;
        let path = path.as_ref();
        self.validate_library_path(path)?;
        self.fs.delete_file(path)?;
        Ok(())
    }

    pub fn entry_from_gdtf_bytes(
        bytes: &[u8],
        path: impl AsRef<str>,
        source: FixtureTypeSource,
    ) -> FixtureTypeResult<FixtureTypeEntry> {
        let summary = read_gdtf_bytes(bytes)?;
        Ok(entry_from_summary(
            summary,
            path.as_ref(),
            bytes.len() as u64,
            source,
        ))
    }

    pub fn create_gdtf_bytes(draft: FixtureTypeDraft) -> FixtureTypeResult<Vec<u8>> {
        Ok(create_gdtf_archive_bytes(&draft.into())?)
    }

    pub fn update_gdtf_bytes(bytes: &[u8], draft: FixtureTypeDraft) -> FixtureTypeResult<Vec<u8>> {
        Ok(update_gdtf_archive_bytes(bytes, &draft.into())?)
    }

    fn entry_from_path(&self, path: &Path) -> FixtureTypeResult<FixtureTypeEntry> {
        self.validate_library_path(path)?;
        let summary = read_gdtf(path)?;
        let size_bytes = self.fs.file_size(path)?;
        Ok(entry_from_summary(
            summary,
            &path_to_string(path),
            size_bytes,
            FixtureTypeSource::Gdtf,
        ))
    }

    fn unique_filename(&self, manufacturer: &str, name: &str) -> String {
        let base = format!(
            "{}@{}",
            sanitize_component(default_if_empty(manufacturer, "Custom")),
            sanitize_component(default_if_empty(name, "Fixture"))
        );
        let mut candidate = format!("{base}.{GDTF_EXTENSION}");
        let mut index = 2_u16;

        while self.paths.gdtf_root.join(&candidate).exists() {
            candidate = format!("{base}_{index}.{GDTF_EXTENSION}");
            index += 1;
        }

        candidate
    }

    fn validate_library_path(&self, path: &Path) -> FixtureTypeResult<()> {
        validate_gdtf_extension(path)?;
        let root = fs::canonicalize(&self.paths.gdtf_root).map_err(PlatformError::from)?;
        let file = fs::canonicalize(path).map_err(PlatformError::from)?;
        if !file.starts_with(&root) {
            return Err(FixtureTypeError::InvalidPath(format!(
                "fixture type is outside GDTF library: {}",
                path.display()
            )));
        }
        Ok(())
    }
}

impl From<FixtureTypeDraft> for GdtfFixtureDraft {
    fn from(value: FixtureTypeDraft) -> Self {
        Self {
            name: value.name,
            manufacturer: value.manufacturer,
            short_name: value.short_name,
            long_name: value.long_name,
            description: value.description,
            modes: value.modes.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<FixtureModeDraft> for limxdesk_gdtf::GdtfModeDraft {
    fn from(value: FixtureModeDraft) -> Self {
        Self {
            id: value.id,
            name: value.name,
            channels: value.channels,
            attributes: value.attributes,
        }
    }
}

fn entry_from_summary(
    summary: GdtfFixtureSummary,
    path: &str,
    size_bytes: u64,
    source: FixtureTypeSource,
) -> FixtureTypeEntry {
    let modes = summary
        .modes
        .into_iter()
        .map(|mode| FixtureModeEntry {
            id: mode.id,
            name: mode.name,
            channels: mode.channels,
            attributes: mode.attributes,
            attribute_details: mode.attribute_details.into_iter().map(Into::into).collect(),
        })
        .collect();

    let attributes = summary
        .attribute_groups
        .into_iter()
        .map(|group| FixtureAttributeGroupEntry {
            id: group.id,
            name: group.name,
            count: group.count,
            encoder_page: group.encoder_page,
        })
        .collect();

    FixtureTypeEntry {
        id: default_if_empty(&summary.fixture_type_id, &Uuid::new_v4().to_string()).to_string(),
        name: summary.name,
        manufacturer: summary.manufacturer,
        short_name: summary.short_name,
        long_name: summary.long_name,
        description: summary.description,
        source,
        used: 0,
        locked: false,
        path: path.to_string(),
        size_bytes,
        modes,
        attributes,
    }
}

impl From<GdtfModeAttributeSummary> for FixtureModeAttributeEntry {
    fn from(value: GdtfModeAttributeSummary) -> Self {
        Self {
            name: value.name,
            feature_group: value.feature_group,
        }
    }
}

fn validate_gdtf_extension(path: &Path) -> FixtureTypeResult<()> {
    if path.extension().and_then(OsStr::to_str) != Some(GDTF_EXTENSION) {
        return Err(FixtureTypeError::InvalidPath(format!(
            "fixture type must use .{GDTF_EXTENSION}: {}",
            path.display()
        )));
    }
    Ok(())
}

fn validate_fixture_name(name: &str) -> FixtureTypeResult<()> {
    if name.trim().is_empty() {
        return Err(FixtureTypeError::InvalidName(
            "fixture type name cannot be empty".to_string(),
        ));
    }
    Ok(())
}

fn sanitize_component(value: &str) -> String {
    let sanitized: String = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();

    default_if_empty(&sanitized, "Fixture").to_string()
}

fn default_if_empty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use limxdesk_platform::{
        FIXTURE_TYPES_DIR_NAME, GDTF_DIR_NAME, LIBRARY_DIR_NAME, SHOW_DIR_NAME,
    };
    use std::env;

    #[test]
    fn repository_creates_updates_and_deletes_gdtf_fixture_types() {
        let root = env::temp_dir().join(format!("limxdesk-fixture-test-{}", Uuid::new_v4()));
        let paths = PlatformPaths {
            program_data_root: root.clone(),
            app_data_root: root.join("LimxDesk"),
            library_root: root.join("LimxDesk").join(LIBRARY_DIR_NAME),
            show_root: root
                .join("LimxDesk")
                .join(LIBRARY_DIR_NAME)
                .join(SHOW_DIR_NAME),
            fixture_types_root: root
                .join("LimxDesk")
                .join(LIBRARY_DIR_NAME)
                .join(FIXTURE_TYPES_DIR_NAME),
            gdtf_root: root
                .join("LimxDesk")
                .join(LIBRARY_DIR_NAME)
                .join(FIXTURE_TYPES_DIR_NAME)
                .join(GDTF_DIR_NAME),
        };
        let repository = FixtureTypeRepository::new(paths);
        let created = repository
            .create(FixtureTypeDraft {
                name: "RGB Bar".to_string(),
                manufacturer: "LimxDesk".to_string(),
                short_name: "RGB".to_string(),
                long_name: "RGB Bar".to_string(),
                description: "test".to_string(),
                modes: vec![FixtureModeDraft {
                    id: "basic".to_string(),
                    name: "Basic".to_string(),
                    channels: 4,
                    attributes: vec!["Dimmer".to_string(), "ColorAdd_R".to_string()],
                }],
            })
            .unwrap();

        assert_eq!(created.name, "RGB Bar");
        assert_eq!(repository.list().unwrap().len(), 1);

        let updated = repository
            .update(
                &created.path,
                FixtureTypeDraft {
                    name: "RGB Bar Edited".to_string(),
                    manufacturer: "LimxDesk".to_string(),
                    short_name: "RGBE".to_string(),
                    long_name: "RGB Bar Edited".to_string(),
                    description: "edited".to_string(),
                    modes: vec![FixtureModeDraft {
                        id: "extended".to_string(),
                        name: "Extended".to_string(),
                        channels: 8,
                        attributes: vec!["Dimmer".to_string(), "ColorAdd_B".to_string()],
                    }],
                },
            )
            .unwrap();
        assert_eq!(updated.name, "RGB Bar Edited");
        assert_eq!(updated.modes[0].channels, 8);

        repository.delete(&created.path).unwrap();
        assert!(repository.list().unwrap().is_empty());

        fs::remove_dir_all(root).unwrap();
    }
}
