use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

pub const DEFAULT_EXECUTOR_COLUMNS: u16 = 15;
pub const DEFAULT_EXECUTOR_ROWS: u16 = 4;

#[derive(Debug)]
pub enum PlaybackError {
    MissingPage(String),
    MissingExecutor(String),
    InvalidExecutor(String),
}

impl fmt::Display for PlaybackError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingPage(id) => write!(formatter, "playback page not found: {id}"),
            Self::MissingExecutor(id) => write!(formatter, "executor not found: {id}"),
            Self::InvalidExecutor(id) => write!(formatter, "invalid executor: {id}"),
        }
    }
}

impl std::error::Error for PlaybackError {}

pub type PlaybackResult<T> = Result<T, PlaybackError>;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackDocument {
    pub pages: Vec<PlaybackPage>,
    pub selected_page_id: Option<String>,
    pub version: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPage {
    pub id: String,
    pub number: u16,
    pub name: String,
    pub executors: Vec<Executor>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Executor {
    pub id: String,
    pub number: u16,
    pub row: u16,
    pub column: u16,
    pub label: String,
    pub assignment: Option<ExecutorAssignment>,
    pub fader: ExecutorFader,
    pub buttons: ExecutorButtons,
    pub appearance_color: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorAssignment {
    pub kind: ExecutorAssignmentKind,
    pub object_id: String,
    pub object_name: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutorAssignmentKind {
    Sequence,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorFader {
    pub master: f64,
    pub temp: f64,
    pub rate: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorButtons {
    pub top: ExecutorButtonAction,
    pub middle: ExecutorButtonAction,
    pub bottom: ExecutorButtonAction,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutorButtonAction {
    Go,
    Back,
    Pause,
    Off,
    Flash,
    Toggle,
    None,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackAction {
    Go,
    Back,
    Pause,
    Off,
    FlashOn,
    FlashOff,
    Toggle,
}

impl PlaybackPage {
    pub fn new(number: u16) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            number,
            name: format!("Page {number}"),
            executors: default_executors(),
        }
    }
}

pub fn normalize_document(mut document: PlaybackDocument) -> PlaybackDocument {
    if document.pages.is_empty() {
        document.pages.push(PlaybackPage::new(1));
    }
    document.pages = document.pages.into_iter().map(normalize_page).collect();
    document.pages.sort_by_key(|page| page.number);
    if let Some(selected) = document.selected_page_id.as_ref() {
        if !document.pages.iter().any(|page| &page.id == selected) {
            document.selected_page_id = document.pages.first().map(|page| page.id.clone());
        }
    } else {
        document.selected_page_id = document.pages.first().map(|page| page.id.clone());
    }
    document
}

pub fn assign_executor(
    mut document: PlaybackDocument,
    page_id: &str,
    executor_id: &str,
    assignment: ExecutorAssignment,
) -> PlaybackResult<PlaybackDocument> {
    document = normalize_document(document);
    let executor = find_executor_mut(&mut document, page_id, executor_id)?;
    executor.label = assignment.object_name.clone();
    executor.assignment = Some(assignment);
    document.version = document.version.saturating_add(1);
    Ok(normalize_document(document))
}

pub fn clear_executor(
    mut document: PlaybackDocument,
    page_id: &str,
    executor_id: &str,
) -> PlaybackResult<PlaybackDocument> {
    document = normalize_document(document);
    let executor = find_executor_mut(&mut document, page_id, executor_id)?;
    executor.label.clear();
    executor.assignment = None;
    executor.fader.master = 1.0;
    document.version = document.version.saturating_add(1);
    Ok(normalize_document(document))
}

pub fn set_executor_master(
    mut document: PlaybackDocument,
    page_id: &str,
    executor_id: &str,
    master: f64,
) -> PlaybackResult<(PlaybackDocument, Option<ExecutorAssignment>)> {
    document = normalize_document(document);
    let executor = find_executor_mut(&mut document, page_id, executor_id)?;
    executor.fader.master = if master.is_finite() { master.clamp(0.0, 1.0) } else { 1.0 };
    let assignment = executor.assignment.clone();
    document.version = document.version.saturating_add(1);
    Ok((normalize_document(document), assignment))
}

pub fn find_executor<'a>(
    document: &'a PlaybackDocument,
    page_id: &str,
    executor_id: &str,
) -> PlaybackResult<&'a Executor> {
    let page = document
        .pages
        .iter()
        .find(|page| page.id == page_id)
        .ok_or_else(|| PlaybackError::MissingPage(page_id.to_string()))?;
    page.executors
        .iter()
        .find(|executor| executor.id == executor_id)
        .ok_or_else(|| PlaybackError::MissingExecutor(executor_id.to_string()))
}

fn find_executor_mut<'a>(
    document: &'a mut PlaybackDocument,
    page_id: &str,
    executor_id: &str,
) -> PlaybackResult<&'a mut Executor> {
    let page = document
        .pages
        .iter_mut()
        .find(|page| page.id == page_id)
        .ok_or_else(|| PlaybackError::MissingPage(page_id.to_string()))?;
    page.executors
        .iter_mut()
        .find(|executor| executor.id == executor_id)
        .ok_or_else(|| PlaybackError::MissingExecutor(executor_id.to_string()))
}

fn normalize_page(mut page: PlaybackPage) -> PlaybackPage {
    page.number = page.number.max(1);
    if page.name.trim().is_empty() {
        page.name = format!("Page {}", page.number);
    } else {
        page.name = page.name.trim().chars().take(96).collect();
    }

    let mut existing = page.executors.into_iter().map(normalize_executor).collect::<Vec<_>>();
    for default_executor in default_executors() {
        if !existing.iter().any(|executor| executor.id == default_executor.id) {
            existing.push(default_executor);
        }
    }
    existing.sort_by_key(|executor| (executor.row, executor.column));
    page.executors = existing;
    page
}

fn normalize_executor(mut executor: Executor) -> Executor {
    executor.row = executor.row.clamp(1, DEFAULT_EXECUTOR_ROWS);
    executor.column = executor.column.clamp(1, DEFAULT_EXECUTOR_COLUMNS);
    if executor.id.trim().is_empty() {
        executor.id = executor_id(executor.row, executor.column);
    }
    executor.number = executor_number(executor.row, executor.column);
    executor.fader.master = executor.fader.master.clamp(0.0, 1.0);
    executor.fader.temp = executor.fader.temp.clamp(0.0, 1.0);
    executor.fader.rate = executor.fader.rate.clamp(0.01, 4.0);
    if executor.appearance_color.trim().is_empty() {
        executor.appearance_color = "#3B4252".to_string();
    }
    executor
}

fn default_executors() -> Vec<Executor> {
    (1..=DEFAULT_EXECUTOR_ROWS)
        .flat_map(|row| {
            (1..=DEFAULT_EXECUTOR_COLUMNS).map(move |column| Executor {
                id: executor_id(row, column),
                number: executor_number(row, column),
                row,
                column,
                label: String::new(),
                assignment: None,
                fader: ExecutorFader {
                    master: 1.0,
                    temp: 0.0,
                    rate: 1.0,
                },
                buttons: ExecutorButtons {
                    top: ExecutorButtonAction::Go,
                    middle: ExecutorButtonAction::Pause,
                    bottom: ExecutorButtonAction::Off,
                },
                appearance_color: "#3B4252".to_string(),
            })
        })
        .collect()
}

fn executor_id(row: u16, column: u16) -> String {
    format!("exec-{row}-{column}")
}

fn executor_number(row: u16, column: u16) -> u16 {
    row * 100 + column
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_document_has_one_page_with_executor_grid() {
        let document = normalize_document(PlaybackDocument::default());
        assert_eq!(document.pages.len(), 1);
        assert_eq!(document.pages[0].executors.len(), 60);
    }

    #[test]
    fn assignment_roundtrips_to_executor() {
        let document = normalize_document(PlaybackDocument::default());
        let page_id = document.pages[0].id.clone();
        let executor_id = document.pages[0].executors[0].id.clone();
        let document = assign_executor(
            document,
            &page_id,
            &executor_id,
            ExecutorAssignment {
                kind: ExecutorAssignmentKind::Sequence,
                object_id: "seq-1".to_string(),
                object_name: "Main".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            document.pages[0].executors[0].assignment.as_ref().unwrap().object_id,
            "seq-1"
        );
    }
}
