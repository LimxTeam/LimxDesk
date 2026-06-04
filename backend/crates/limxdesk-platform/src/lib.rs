use serde::Serialize;
use std::{
    env,
    ffi::OsStr,
    fmt, fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const APP_DIR_NAME: &str = "LimxDesk";
pub const LIBRARY_DIR_NAME: &str = "Library";
pub const SHOW_DIR_NAME: &str = "Show";

#[derive(Debug)]
pub enum PlatformError {
    Io(io::Error),
    InvalidPath(String),
}

impl fmt::Display for PlatformError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::InvalidPath(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for PlatformError {}

impl From<io::Error> for PlatformError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

pub type PlatformResult<T> = Result<T, PlatformError>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPaths {
    pub program_data_root: PathBuf,
    pub app_data_root: PathBuf,
    pub library_root: PathBuf,
    pub show_root: PathBuf,
}

impl PlatformPaths {
    pub fn for_current_os() -> Self {
        let program_data_root = platform_program_data_root();
        let app_data_root = program_data_root.join(APP_DIR_NAME);
        let library_root = app_data_root.join(LIBRARY_DIR_NAME);
        let show_root = library_root.join(SHOW_DIR_NAME);

        Self {
            program_data_root,
            app_data_root,
            library_root,
            show_root,
        }
    }

    pub fn ensure_base_layout(&self) -> PlatformResult<()> {
        fs::create_dir_all(&self.show_root)?;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct LocalFileSystem;

impl LocalFileSystem {
    pub fn ensure_dir(&self, path: impl AsRef<Path>) -> PlatformResult<()> {
        fs::create_dir_all(path)?;
        Ok(())
    }

    pub fn read(&self, path: impl AsRef<Path>) -> PlatformResult<Vec<u8>> {
        Ok(fs::read(path)?)
    }

    pub fn atomic_write(&self, path: impl AsRef<Path>, bytes: &[u8]) -> PlatformResult<()> {
        let path = path.as_ref();
        let parent = path.parent().ok_or_else(|| {
            PlatformError::InvalidPath(format!("path has no parent: {}", path.display()))
        })?;

        self.ensure_dir(parent)?;

        let temporary_path = parent.join(format!(
            ".{}.tmp",
            current_timestamp_millis().unwrap_or_default()
        ));

        fs::write(&temporary_path, bytes)?;
        if path.exists() {
            fs::remove_file(path)?;
        }

        match fs::rename(&temporary_path, path) {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ = fs::remove_file(&temporary_path);
                Err(PlatformError::Io(error))
            }
        }
    }

    pub fn delete_file(&self, path: impl AsRef<Path>) -> PlatformResult<()> {
        fs::remove_file(path)?;
        Ok(())
    }

    pub fn file_size(&self, path: impl AsRef<Path>) -> PlatformResult<u64> {
        Ok(fs::metadata(path)?.len())
    }

    pub fn list_files_with_extension(
        &self,
        dir: impl AsRef<Path>,
        extension: &str,
    ) -> PlatformResult<Vec<PathBuf>> {
        let dir = dir.as_ref();
        self.ensure_dir(dir)?;

        let mut files = Vec::new();
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() && has_extension(&path, extension) {
                files.push(path);
            }
        }

        files.sort_by(|left, right| {
            left.file_name()
                .unwrap_or_else(|| OsStr::new(""))
                .cmp(right.file_name().unwrap_or_else(|| OsStr::new("")))
        });

        Ok(files)
    }
}

pub fn current_timestamp_millis() -> PlatformResult<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| PlatformError::InvalidPath(error.to_string()))?;
    Ok(duration.as_millis() as u64)
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
}

fn platform_program_data_root() -> PathBuf {
    if cfg!(windows) {
        env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            .unwrap_or_else(|| PathBuf::from("/var/lib"))
    }
}
