// ============================================================
// 文件名称：frame.rs
// 功能描述：关键帧 —— 某个相位角度上的一组属性快照
//
// 关键帧记录的是"打帧那一刻编程器里的值"，不是算出来的曲线。调成红色打
// 一帧、调成蓝色再打一帧，效果就从红跑到蓝；位置同理，打两个朝向就在两者
// 之间扫。这是关键帧与预制效果的分界：预制效果替你决定跑什么，关键帧记录
// 你做过什么。
//
// 一帧横跨所有属性而不是每个属性各有一套帧：颜色是 R/G/B 三个属性，位置是
// Pan/Tilt 两个，它们必须在同一个时刻一起被记录，否则"红色"会被拆成三条
// 互不相干的曲线，根本无法作为一个颜色来编辑。
// ============================================================

use crate::curve::{normalize_angle, Handle, Interpolation};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// 一帧里某个属性的取值。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameValue {
    pub attribute: String,
    pub value: f64,
}

/// 一个关键帧。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub id: String,
    /// 在周期中的位置，0..360 度。
    pub angle: f64,
    /// 打帧时捕获的各属性值。
    pub values: Vec<FrameValue>,
    /// 从本帧到下一帧的过渡方式。
    pub interpolation: Interpolation,
    pub handle_out: Handle,
    pub handle_in: Handle,
}

impl Keyframe {
    /// 用一组属性值建一帧。
    pub fn capture(angle: f64, values: Vec<FrameValue>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            angle: normalize_angle(angle),
            values,
            interpolation: Interpolation::Smooth,
            handle_out: Handle::default(),
            handle_in: Handle::default(),
        }
    }

    pub fn value_of(&self, attribute: &str) -> Option<f64> {
        self.values
            .iter()
            .find(|value| value.attribute == attribute)
            .map(|value| value.value)
    }

    pub fn set_value(&mut self, attribute: &str, value: f64) {
        match self
            .values
            .iter_mut()
            .find(|existing| existing.attribute == attribute)
        {
            Some(existing) => existing.value = value,
            None => self.values.push(FrameValue {
                attribute: attribute.to_string(),
                value,
            }),
        }
    }

    pub fn remove_value(&mut self, attribute: &str) {
        self.values.retain(|value| value.attribute != attribute);
    }
}

/// 参与效果的一个属性。
///
/// 属性在这里登记一次，帧里按名字引用它。停用某个属性就是让效果不再驱动
/// 它，而不必把每一帧里的值都删掉 —— 那样改回来就得重打所有帧。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectAttribute {
    pub attribute: String,
    pub feature_group: String,
    pub layer: crate::TrackLayer,
    pub enabled: bool,
}

impl EffectAttribute {
    pub fn new(attribute: impl Into<String>, feature_group: impl Into<String>) -> Self {
        Self {
            attribute: attribute.into(),
            feature_group: feature_group.into(),
            layer: crate::TrackLayer::Absolute,
            enabled: true,
        }
    }
}

/// 按角度排序，并把角度折算进 [0, 360)。
pub fn sort_frames(frames: &mut Vec<Keyframe>) {
    for frame in frames.iter_mut() {
        frame.angle = normalize_angle(frame.angle);
        if frame.id.trim().is_empty() {
            frame.id = Uuid::new_v4().to_string();
        }
        frame.values.retain(|value| {
            !value.attribute.trim().is_empty() && value.value.is_finite()
        });
    }
    frames.sort_by(|left, right| left.angle.total_cmp(&right.angle));
}

/// 取出某个属性在各帧上的取值序列，供曲线求值使用。
///
/// 没有记录该属性的帧会被跳过 —— 一帧只捕获打帧时激活的属性，后加入的
/// 属性在早先的帧里本来就没有值，跳过比补一个零合理：补零会让灯在那一段
/// 突然熄掉。
pub fn attribute_track<'a>(frames: &'a [Keyframe], attribute: &str) -> Vec<(f64, f64, &'a Keyframe)> {
    frames
        .iter()
        .filter_map(|frame| {
            frame
                .value_of(attribute)
                .map(|value| (frame.angle, value, frame))
        })
        .collect()
}

/// 一帧里出现过的所有属性，按首次出现的次序。
pub fn attributes_in(frames: &[Keyframe]) -> Vec<String> {
    let mut seen = BTreeMap::new();
    let mut order = Vec::new();
    for frame in frames {
        for value in &frame.values {
            if seen.insert(value.attribute.clone(), ()).is_none() {
                order.push(value.attribute.clone());
            }
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(angle: f64, values: &[(&str, f64)]) -> Keyframe {
        Keyframe::capture(
            angle,
            values
                .iter()
                .map(|(attribute, value)| FrameValue {
                    attribute: attribute.to_string(),
                    value: *value,
                })
                .collect(),
        )
    }

    #[test]
    fn a_frame_captures_several_attributes_at_once() {
        // 红色是三个属性同时成立的一件事，不能拆成三条独立的曲线。
        let red = frame(0.0, &[("ColorRGB_R", 255.0), ("ColorRGB_G", 0.0), ("ColorRGB_B", 0.0)]);
        assert_eq!(red.value_of("ColorRGB_R"), Some(255.0));
        assert_eq!(red.value_of("ColorRGB_B"), Some(0.0));
        assert_eq!(red.value_of("Dimmer"), None);
    }

    #[test]
    fn frames_sort_by_angle_and_normalise() {
        let mut frames = vec![frame(400.0, &[("Dimmer", 1.0)]), frame(0.0, &[("Dimmer", 2.0)])];
        sort_frames(&mut frames);
        assert_eq!(frames[0].angle, 0.0);
        assert_eq!(frames[1].angle, 40.0);
    }

    #[test]
    fn an_attribute_track_skips_frames_that_never_recorded_it() {
        // 后加入的属性在早先的帧里没有值，跳过而不是补零 ——
        // 补零会让灯在那一段突然熄掉。
        let frames = vec![
            frame(0.0, &[("Dimmer", 10.0)]),
            frame(120.0, &[("Dimmer", 20.0), ("Pan", 5.0)]),
            frame(240.0, &[("Pan", 15.0)]),
        ];

        let dimmer = attribute_track(&frames, "Dimmer");
        assert_eq!(dimmer.len(), 2);
        assert_eq!(dimmer[0].1, 10.0);

        let pan = attribute_track(&frames, "Pan");
        assert_eq!(pan.len(), 2);
        assert_eq!(pan[0].0, 120.0);
    }

    #[test]
    fn attributes_are_listed_in_first_appearance_order() {
        let frames = vec![
            frame(0.0, &[("Dimmer", 1.0)]),
            frame(180.0, &[("Pan", 2.0), ("Dimmer", 3.0)]),
        ];
        assert_eq!(attributes_in(&frames), vec!["Dimmer".to_string(), "Pan".to_string()]);
    }

    #[test]
    fn setting_a_value_replaces_rather_than_duplicates() {
        let mut item = frame(0.0, &[("Dimmer", 10.0)]);
        item.set_value("Dimmer", 40.0);
        item.set_value("Pan", 5.0);

        assert_eq!(item.values.len(), 2);
        assert_eq!(item.value_of("Dimmer"), Some(40.0));
    }

    #[test]
    fn removing_a_value_leaves_the_rest_intact() {
        let mut item = frame(0.0, &[("Dimmer", 10.0), ("Pan", 5.0)]);
        item.remove_value("Dimmer");
        assert_eq!(item.value_of("Dimmer"), None);
        assert_eq!(item.value_of("Pan"), Some(5.0));
    }

    #[test]
    fn non_finite_values_are_dropped_on_sort() {
        let mut frames = vec![frame(0.0, &[("Dimmer", f64::NAN), ("Pan", 5.0)])];
        sort_frames(&mut frames);
        assert_eq!(frames[0].value_of("Dimmer"), None);
        assert_eq!(frames[0].value_of("Pan"), Some(5.0));
    }
}
