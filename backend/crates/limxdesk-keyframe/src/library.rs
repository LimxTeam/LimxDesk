// ============================================================
// 文件名称：library.rs
// 功能描述：可复用的效果集合
//
// 效果是独立对象，sequence 上的配方槽按 id 引用它。这样同一个效果可以
// 挂在多处，改一次处处生效；也让渲染路径只做一次哈希查找，不必在每帧
// 反序列化内联配置。
// ============================================================

use crate::{normalize_effect, KeyframeEffect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 落盘形态。
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeLibraryDocument {
    pub effects: Vec<KeyframeEffect>,
    pub selected_effect_id: Option<String>,
    pub version: u64,
}

/// 运行时形态：按 id 建索引。
#[derive(Clone, Debug, Default)]
pub struct KeyframeLibrary {
    effects: Vec<KeyframeEffect>,
    by_id: HashMap<String, usize>,
    version: u64,
}

impl KeyframeLibrary {
    pub fn from_document(document: &KeyframeLibraryDocument) -> Self {
        let effects = document
            .effects
            .iter()
            .cloned()
            .map(normalize_effect)
            .collect::<Vec<_>>();
        let by_id = effects
            .iter()
            .enumerate()
            .map(|(index, effect)| (effect.id.clone(), index))
            .collect();
        Self {
            effects,
            by_id,
            version: document.version,
        }
    }

    pub fn get(&self, effect_id: &str) -> Option<&KeyframeEffect> {
        self.by_id
            .get(effect_id)
            .and_then(|index| self.effects.get(*index))
    }

    pub fn effects(&self) -> &[KeyframeEffect] {
        &self.effects
    }

    pub fn version(&self) -> u64 {
        self.version
    }

    pub fn is_empty(&self) -> bool {
        self.effects.is_empty()
    }
}

/// 规整整份文档：编号去重、按编号排序。
pub fn normalize_document(mut document: KeyframeLibraryDocument) -> KeyframeLibraryDocument {
    document.effects = document.effects.into_iter().map(normalize_effect).collect();
    document.effects.sort_by_key(|effect| effect.number);
    document.effects.dedup_by(|left, right| left.id == right.id);

    if let Some(selected) = document.selected_effect_id.as_ref() {
        if !document.effects.iter().any(|effect| &effect.id == selected) {
            document.selected_effect_id = document.effects.first().map(|effect| effect.id.clone());
        }
    }
    document
}

/// 下一个可用编号。
pub fn next_effect_number(document: &KeyframeLibraryDocument) -> u32 {
    document
        .effects
        .iter()
        .map(|effect| effect.number)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FrameValue;

    fn document_with(effects: Vec<KeyframeEffect>) -> KeyframeLibraryDocument {
        KeyframeLibraryDocument {
            effects,
            selected_effect_id: None,
            version: 1,
        }
    }

    #[test]
    fn effects_are_looked_up_by_id() {
        let mut effect = KeyframeEffect::new(1, "Sine", 0);
        effect.capture(
            0.0,
            &[FrameValue {
                attribute: "Dimmer".to_string(),
                feature_group: "Dimmer".to_string(),
                value: 10.0,
            }],
        );
        let id = effect.id.clone();

        let library = KeyframeLibrary::from_document(&document_with(vec![effect]));

        assert_eq!(library.get(&id).map(|effect| effect.name.as_str()), Some("Sine"));
        assert!(library.get("missing").is_none());
    }

    #[test]
    fn documents_normalise_on_load() {
        let mut effect = KeyframeEffect::new(1, "", 0);
        effect.cycle_ms = f64::NAN;
        let library = KeyframeLibrary::from_document(&document_with(vec![effect.clone()]));
        let loaded = library.get(&effect.id).unwrap();

        assert_eq!(loaded.name, "Effect 1");
        assert!(loaded.cycle_ms.is_finite());
    }

    #[test]
    fn numbering_continues_from_the_highest_in_use() {
        let document = document_with(vec![
            KeyframeEffect::new(1, "A", 0),
            KeyframeEffect::new(7, "B", 0),
        ]);
        assert_eq!(next_effect_number(&document), 8);
        assert_eq!(next_effect_number(&document_with(Vec::new())), 1);
    }

    #[test]
    fn a_dangling_selection_falls_back_to_the_first_effect() {
        let mut document = document_with(vec![KeyframeEffect::new(1, "A", 0)]);
        document.selected_effect_id = Some("gone".to_string());
        let document = normalize_document(document);
        assert_eq!(document.selected_effect_id, Some(document.effects[0].id.clone()));
    }
}
