use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FixtureSelection {
    pub fixture_ids: Vec<String>,
    pub primary_fixture_id: Option<String>,
    pub version: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FixtureSelectionMode {
    Replace,
    Add,
    Remove,
    Toggle,
}

impl FixtureSelection {
    pub fn select(
        &self,
        fixture_ids: Vec<String>,
        primary_fixture_id: Option<String>,
        mode: FixtureSelectionMode,
    ) -> Self {
        let mut ids = match mode {
            FixtureSelectionMode::Replace => Vec::new(),
            _ => self.fixture_ids.clone(),
        };

        match mode {
            FixtureSelectionMode::Replace | FixtureSelectionMode::Add => {
                for id in fixture_ids {
                    push_unique(&mut ids, id);
                }
            }
            FixtureSelectionMode::Remove => {
                let remove_ids: BTreeSet<_> = fixture_ids.into_iter().collect();
                ids.retain(|id| !remove_ids.contains(id));
            }
            FixtureSelectionMode::Toggle => {
                for id in fixture_ids {
                    if ids.iter().any(|existing| existing == &id) {
                        ids.retain(|existing| existing != &id);
                    } else {
                        ids.push(id);
                    }
                }
            }
        }

        let primary = resolve_primary(&ids, primary_fixture_id, self.primary_fixture_id.clone());
        Self {
            fixture_ids: ids,
            primary_fixture_id: primary,
            version: self.version.saturating_add(1),
        }
    }

    pub fn clear(&self) -> Self {
        Self {
            fixture_ids: Vec::new(),
            primary_fixture_id: None,
            version: self.version.saturating_add(1),
        }
    }
}

fn push_unique(ids: &mut Vec<String>, id: String) {
    if id.trim().is_empty() {
        return;
    }
    if !ids.iter().any(|existing| existing == &id) {
        ids.push(id);
    }
}

fn resolve_primary(
    ids: &[String],
    requested: Option<String>,
    previous: Option<String>,
) -> Option<String> {
    requested
        .filter(|id| ids.iter().any(|existing| existing == id))
        .or_else(|| previous.filter(|id| ids.iter().any(|existing| existing == id)))
        .or_else(|| ids.first().cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_sets_primary_and_deduplicates_ids() {
        let selection = FixtureSelection::default().select(
            vec!["a".to_string(), "a".to_string(), "b".to_string()],
            Some("b".to_string()),
            FixtureSelectionMode::Replace,
        );

        assert_eq!(selection.fixture_ids, vec!["a", "b"]);
        assert_eq!(selection.primary_fixture_id.as_deref(), Some("b"));
        assert_eq!(selection.version, 1);
    }

    #[test]
    fn toggle_removes_existing_and_adds_new() {
        let initial = FixtureSelection::default().select(
            vec!["a".to_string(), "b".to_string()],
            Some("a".to_string()),
            FixtureSelectionMode::Replace,
        );
        let selection = initial.select(
            vec!["a".to_string(), "c".to_string()],
            Some("c".to_string()),
            FixtureSelectionMode::Toggle,
        );

        assert_eq!(selection.fixture_ids, vec!["b", "c"]);
        assert_eq!(selection.primary_fixture_id.as_deref(), Some("c"));
    }

    #[test]
    fn clear_increments_version() {
        let initial = FixtureSelection::default().select(
            vec!["a".to_string()],
            None,
            FixtureSelectionMode::Replace,
        );
        let cleared = initial.clear();

        assert!(cleared.fixture_ids.is_empty());
        assert_eq!(cleared.version, 2);
    }
}
