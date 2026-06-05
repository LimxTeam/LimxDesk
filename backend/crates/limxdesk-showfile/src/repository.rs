use limxdesk_platform::{current_timestamp_millis, LocalFileSystem, PlatformError, PlatformPaths};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fmt, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use uuid::Uuid;

use crate::codec::{decode_container, encode_container};

pub const SHOW_EXTENSION: &str = "limxdsek";
pub const SHOW_FORMAT_VERSION: u16 = 1;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const ACTIVE_SHOW_FILE_NAME: &str = "active-show.json";

#[derive(Debug)]
pub enum ShowFileError {
    Platform(PlatformError),
    Json(serde_json::Error),
    Crypto(String),
    InvalidFormat(String),
    InvalidName(String),
    InvalidPath(String),
}

impl fmt::Display for ShowFileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Platform(error) => write!(formatter, "{error}"),
            Self::Json(error) => write!(formatter, "{error}"),
            Self::Crypto(message)
            | Self::InvalidFormat(message)
            | Self::InvalidName(message)
            | Self::InvalidPath(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for ShowFileError {}

impl From<PlatformError> for ShowFileError {
    fn from(value: PlatformError) -> Self {
        Self::Platform(value)
    }
}

impl From<serde_json::Error> for ShowFileError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

pub type ShowFileResult<T> = Result<T, ShowFileError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowManifest {
    pub id: Uuid,
    pub name: String,
    pub format_version: u16,
    pub created_at_ms: u64,
    pub modified_at_ms: u64,
    pub app_version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowSection {
    pub key: String,
    pub version: u16,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShowContainer {
    pub manifest: ShowManifest,
    pub sections: Vec<ShowSection>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowFileEntry {
    pub id: Uuid,
    pub name: String,
    pub path: String,
    pub created_at_ms: u64,
    pub modified_at_ms: u64,
    pub size_bytes: u64,
    pub format_version: u16,
    pub app_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedShow {
    pub manifest: ShowManifest,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct LoadedShowDocument {
    pub loaded: LoadedShow,
    pub sections: Vec<ShowSection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveShowPointer {
    show_id: Uuid,
    path: String,
    updated_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct ShowRepository {
    paths: PlatformPaths,
    fs: LocalFileSystem,
}

impl ShowRepository {
    pub fn new(paths: PlatformPaths) -> Self {
        Self {
            paths,
            fs: LocalFileSystem,
        }
    }

    pub fn default_for_current_os() -> Self {
        Self::new(PlatformPaths::for_current_os())
    }

    pub fn show_root(&self) -> &Path {
        &self.paths.show_root
    }

    pub fn ensure_library(&self) -> ShowFileResult<()> {
        self.paths.ensure_base_layout()?;
        Ok(())
    }

    pub fn list(&self) -> ShowFileResult<Vec<ShowFileEntry>> {
        self.ensure_library()?;

        let mut entries = Vec::new();
        for path in self
            .fs
            .list_files_with_extension(&self.paths.show_root, SHOW_EXTENSION)?
        {
            let loaded = self.load_path(&path)?;
            entries.push(ShowFileEntry::from_loaded(loaded));
        }

        entries.sort_by(|left, right| right.modified_at_ms.cmp(&left.modified_at_ms));
        Ok(entries)
    }

    pub fn create(&self, name: impl AsRef<str>) -> ShowFileResult<LoadedShow> {
        self.ensure_library()?;

        let now = current_timestamp_millis()?;
        let name = sanitize_show_name(name.as_ref())?;
        let path = self.unique_path_for_name(&name);
        let container = ShowContainer {
            manifest: ShowManifest {
                id: Uuid::new_v4(),
                name,
                format_version: SHOW_FORMAT_VERSION,
                created_at_ms: now,
                modified_at_ms: now,
                app_version: APP_VERSION.to_string(),
            },
            sections: Vec::new(),
        };

        self.write_container(&path, &container)?;
        self.load_path(&path)
    }

    pub fn load(&self, path: impl AsRef<Path>) -> ShowFileResult<LoadedShow> {
        self.ensure_library()?;
        self.load_path(path.as_ref())
    }

    pub fn load_document(&self, path: impl AsRef<Path>) -> ShowFileResult<LoadedShowDocument> {
        self.ensure_library()?;
        let path = path.as_ref();
        self.validate_show_path(path)?;
        let container = self.read_container(path)?;
        let size_bytes = self.fs.file_size(path)?;
        Ok(LoadedShowDocument {
            loaded: LoadedShow {
                manifest: container.manifest,
                path: path_to_string(path),
                size_bytes,
            },
            sections: container.sections,
        })
    }

    pub fn save_document(
        &self,
        path: impl AsRef<Path>,
        sections: Vec<ShowSection>,
    ) -> ShowFileResult<LoadedShowDocument> {
        self.ensure_library()?;

        let path = path.as_ref();
        self.validate_show_path(path)?;
        let mut container = self.read_container(path)?;
        container.sections = sections;
        container.manifest.modified_at_ms = current_timestamp_millis()?;
        self.write_container(path, &container)?;
        self.load_document(path)
    }

    pub fn save(&self, path: impl AsRef<Path>) -> ShowFileResult<LoadedShow> {
        self.ensure_library()?;

        let path = path.as_ref();
        self.validate_show_path(path)?;
        let mut container = self.read_container(path)?;
        container.manifest.modified_at_ms = current_timestamp_millis()?;
        self.write_container(path, &container)?;
        self.load_path(path)
    }

    pub fn read_section<T>(
        &self,
        path: impl AsRef<Path>,
        key: impl AsRef<str>,
    ) -> ShowFileResult<Option<T>>
    where
        T: for<'de> Deserialize<'de>,
    {
        self.ensure_library()?;

        let path = path.as_ref();
        self.validate_show_path(path)?;
        let container = self.read_container(path)?;
        let key = key.as_ref();
        let Some(section) = container.sections.iter().find(|section| section.key == key) else {
            return Ok(None);
        };

        Ok(Some(serde_json::from_slice(&section.payload)?))
    }

    pub fn write_section<T>(
        &self,
        path: impl AsRef<Path>,
        key: impl Into<String>,
        version: u16,
        value: &T,
    ) -> ShowFileResult<LoadedShow>
    where
        T: Serialize,
    {
        self.ensure_library()?;

        let path = path.as_ref();
        self.validate_show_path(path)?;
        let key = key.into();
        let payload = serde_json::to_vec(value)?;
        let mut container = self.read_container(path)?;

        if let Some(section) = container
            .sections
            .iter_mut()
            .find(|section| section.key == key)
        {
            section.version = version;
            section.payload = payload;
        } else {
            container.sections.push(ShowSection {
                key,
                version,
                payload,
            });
        }

        container.manifest.modified_at_ms = current_timestamp_millis()?;
        self.write_container(path, &container)?;
        self.load_path(path)
    }

    pub fn save_as(
        &self,
        source_path: impl AsRef<Path>,
        name: impl AsRef<str>,
    ) -> ShowFileResult<LoadedShow> {
        self.ensure_library()?;

        let source_path = source_path.as_ref();
        self.validate_show_path(source_path)?;
        let mut container = self.read_container(source_path)?;
        let now = current_timestamp_millis()?;
        let name = sanitize_show_name(name.as_ref())?;
        let target_path = self.unique_path_for_name(&name);

        container.manifest.id = Uuid::new_v4();
        container.manifest.name = name;
        container.manifest.created_at_ms = now;
        container.manifest.modified_at_ms = now;

        self.write_container(&target_path, &container)?;
        self.load_path(&target_path)
    }

    pub fn save_document_as(
        &self,
        source_path: impl AsRef<Path>,
        name: impl AsRef<str>,
        sections: Vec<ShowSection>,
    ) -> ShowFileResult<LoadedShowDocument> {
        self.ensure_library()?;

        let source_path = source_path.as_ref();
        self.validate_show_path(source_path)?;
        let mut container = self.read_container(source_path)?;
        let now = current_timestamp_millis()?;
        let name = sanitize_show_name(name.as_ref())?;
        let target_path = self.unique_path_for_name(&name);

        container.manifest.id = Uuid::new_v4();
        container.manifest.name = name;
        container.manifest.created_at_ms = now;
        container.manifest.modified_at_ms = now;
        container.sections = sections;

        self.write_container(&target_path, &container)?;
        self.load_document(&target_path)
    }

    pub fn delete(&self, path: impl AsRef<Path>) -> ShowFileResult<()> {
        self.ensure_library()?;
        let path = path.as_ref();
        self.validate_show_path(path)?;
        self.fs.delete_file(path)?;
        Ok(())
    }

    pub fn activate(&self, loaded: &LoadedShow) -> ShowFileResult<()> {
        self.ensure_library()?;
        let pointer = ActiveShowPointer {
            show_id: loaded.manifest.id,
            path: loaded.path.clone(),
            updated_at_ms: current_timestamp_millis()?,
        };
        let bytes = serde_json::to_vec_pretty(&pointer)?;
        self.fs.atomic_write(self.active_show_path(), &bytes)?;
        Ok(())
    }

    pub fn load_active(&self) -> ShowFileResult<Option<LoadedShow>> {
        self.ensure_library()?;
        let path = self.active_show_path();
        if !path.exists() {
            return Ok(None);
        }

        let bytes = self.fs.read(&path)?;
        let pointer: ActiveShowPointer = serde_json::from_slice(&bytes)?;
        let loaded = match self.load(&pointer.path) {
            Ok(loaded) => loaded,
            Err(ShowFileError::Platform(PlatformError::Io(error)))
                if error.kind() == ErrorKind::NotFound =>
            {
                self.clear_active()?;
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        if loaded.manifest.id != pointer.show_id {
            return Err(ShowFileError::InvalidFormat(format!(
                "active show pointer id mismatch: {}",
                pointer.path
            )));
        }

        Ok(Some(loaded))
    }

    pub fn clear_active(&self) -> ShowFileResult<()> {
        self.ensure_library()?;
        let path = self.active_show_path();
        if path.exists() {
            self.fs.delete_file(path)?;
        }
        Ok(())
    }

    fn load_path(&self, path: &Path) -> ShowFileResult<LoadedShow> {
        self.validate_show_path(path)?;
        let container = self.read_container(path)?;
        let size_bytes = self.fs.file_size(path)?;

        Ok(LoadedShow {
            manifest: container.manifest,
            path: path_to_string(path),
            size_bytes,
        })
    }

    fn read_container(&self, path: &Path) -> ShowFileResult<ShowContainer> {
        let bytes = self.fs.read(path)?;
        decode_container(&bytes)
    }

    fn write_container(&self, path: &Path, container: &ShowContainer) -> ShowFileResult<()> {
        let bytes = encode_container(container)?;
        self.fs.atomic_write(path, &bytes)?;
        Ok(())
    }

    fn unique_path_for_name(&self, name: &str) -> PathBuf {
        let mut candidate = self
            .paths
            .show_root
            .join(format!("{name}.{SHOW_EXTENSION}"));
        let mut index = 2_u16;

        while candidate.exists() {
            candidate = self
                .paths
                .show_root
                .join(format!("{name}_{index}.{SHOW_EXTENSION}"));
            index += 1;
        }

        candidate
    }

    fn active_show_path(&self) -> PathBuf {
        self.paths.app_data_root.join(ACTIVE_SHOW_FILE_NAME)
    }

    fn validate_show_path(&self, path: &Path) -> ShowFileResult<()> {
        if path.extension().and_then(OsStr::to_str) != Some(SHOW_EXTENSION) {
            return Err(ShowFileError::InvalidPath(format!(
                "show file must use .{SHOW_EXTENSION}: {}",
                path.display()
            )));
        }

        let root = fs::canonicalize(&self.paths.show_root).map_err(PlatformError::from)?;
        let file = fs::canonicalize(path).map_err(PlatformError::from)?;
        if !file.starts_with(&root) {
            return Err(ShowFileError::InvalidPath(format!(
                "show file is outside library root: {}",
                path.display()
            )));
        }

        Ok(())
    }
}

impl ShowFileEntry {
    fn from_loaded(loaded: LoadedShow) -> Self {
        Self {
            id: loaded.manifest.id,
            name: loaded.manifest.name,
            path: loaded.path,
            created_at_ms: loaded.manifest.created_at_ms,
            modified_at_ms: loaded.manifest.modified_at_ms,
            size_bytes: loaded.size_bytes,
            format_version: loaded.manifest.format_version,
            app_version: loaded.manifest.app_version,
        }
    }
}

fn sanitize_show_name(value: &str) -> ShowFileResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ShowFileError::InvalidName(
            "show name cannot be empty".to_string(),
        ));
    }

    let mut sanitized = String::with_capacity(trimmed.len());
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ' ') {
            sanitized.push(character);
        } else {
            sanitized.push('_');
        }
    }

    let sanitized = sanitized.trim().replace(' ', "_");
    if sanitized.is_empty() {
        return Err(ShowFileError::InvalidName(
            "show name contains no valid filename characters".to_string(),
        ));
    }

    Ok(sanitized)
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
    fn show_repository_roundtrips_single_file_container() {
        let root = env::temp_dir().join(format!("limxdesk-showfile-test-{}", Uuid::new_v4()));
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
        let repository = ShowRepository::new(paths);

        let created = repository.create("Integration Show").unwrap();
        assert_eq!(created.manifest.name, "Integration_Show");
        assert!(created.path.ends_with(".limxdsek"));

        let listed = repository.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.manifest.id);

        let loaded = repository.load(&created.path).unwrap();
        assert_eq!(loaded.manifest.id, created.manifest.id);

        repository.activate(&loaded).unwrap();
        let active = repository.load_active().unwrap().unwrap();
        assert_eq!(active.manifest.id, loaded.manifest.id);
        assert_eq!(active.path, loaded.path);

        let saved = repository.save(&created.path).unwrap();
        assert!(saved.manifest.modified_at_ms >= loaded.manifest.modified_at_ms);

        let section_value = serde_json::json!({
            "fixtures": [
                { "fid": 1, "name": "Dimmer 1", "universe": 1, "address": 1 }
            ]
        });
        repository
            .write_section(&created.path, "patch.v1", 1, &section_value)
            .unwrap();
        let restored: serde_json::Value = repository
            .read_section(&created.path, "patch.v1")
            .unwrap()
            .unwrap();
        assert_eq!(restored["fixtures"][0]["fid"], 1);

        let copied = repository.save_as(&created.path, "Copied Show").unwrap();
        assert_ne!(copied.manifest.id, created.manifest.id);
        assert_eq!(copied.manifest.name, "Copied_Show");

        repository.delete(&created.path).unwrap();
        let listed = repository.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, copied.manifest.id);

        repository.clear_active().unwrap();
        assert!(repository.load_active().unwrap().is_none());

        fs::remove_dir_all(root).unwrap();
    }
}
