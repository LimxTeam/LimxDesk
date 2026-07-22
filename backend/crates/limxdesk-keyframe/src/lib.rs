// ============================================================
// 文件名称：lib.rs
// 功能描述：关键帧效果 —— LimxDesk 效果体系中的一种
//
// 关键帧记录的是"打帧那一刻编程器里的值"。把灯调成红色打一帧、调成蓝色
// 再打一帧，效果就在红蓝之间跑；位置同理，打两个朝向就在两者之间扫。
// 这里不替用户决定跑什么 —— 那是预制效果的事。
//
// 一帧横跨所有属性，而不是每个属性各有一套帧：颜色是 R/G/B 三个属性、
// 位置是 Pan/Tilt 两个，它们必须在同一时刻一起被捕获，否则"红色"会散成
// 三条互不相干的曲线，没法作为一个颜色来编辑。
//
//   frame     关键帧与属性登记
//   curve     两帧之间怎么过渡
//   playback  时间 → 周期角度（循环 / 反弹 / 倒放 / 单次 / 定次）
//   phase     一组灯之间怎么错开
//   library   可复用的效果集合
//
// 这个 crate 只管求值，不知道 DMX、不知道回放引擎。接线在 engine 侧。
// ============================================================

pub mod curve;
pub mod frame;
pub mod library;
pub mod phase;
pub mod playback;

pub use curve::{normalize_angle, sample_points, CurvePoint, Handle, Interpolation, CYCLE_DEGREES};
pub use frame::{
    attribute_track, attributes_in, sort_frames, EffectAttribute, FrameValue, Keyframe,
};
pub use library::{KeyframeLibrary, KeyframeLibraryDocument};
pub use phase::PhaseSpread;
pub use playback::{CyclePosition, PlaybackMode};

use limxdesk_effect::EffectOverrides;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 属性产出的值怎么进入合成。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrackLayer {
    /// 帧里记录的值就是最终值。
    #[default]
    Absolute,
    /// 帧里记录的值是相对基准的偏移，叠加在回放之上。
    Relative,
}

/// 一个关键帧效果模板。
///
/// 只描述形状、速度与相位规则，不含灯具 —— 作用于谁由效果实例
/// （limxdesk-effect 的 AppliedEffect）决定，模板因此可被任意多处复用。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeEffect {
    pub id: String,
    pub number: u32,
    pub name: String,
    /// 跑完一圈要多久（毫秒）。这就是速度控制。
    pub cycle_ms: f64,
    pub playback: PlaybackMode,
    pub phase: PhaseSpread,
    /// 参与效果的属性登记表。
    pub attributes: Vec<EffectAttribute>,
    /// 关键帧，按角度排序。
    pub frames: Vec<Keyframe>,
    pub updated_at_ms: u64,
}

impl KeyframeEffect {
    pub fn new(number: u32, name: impl Into<String>, now_ms: u64) -> Self {
        let name = name.into();
        Self {
            id: Uuid::new_v4().to_string(),
            number,
            name: if name.trim().is_empty() {
                format!("Effect {number}")
            } else {
                name
            },
            cycle_ms: 2000.0,
            playback: PlaybackMode::Loop,
            phase: PhaseSpread::default(),
            attributes: Vec::new(),
            frames: Vec::new(),
            updated_at_ms: now_ms,
        }
    }

    /// 该效果是否会一直动下去。用来决定回放时钟能不能停。
    pub fn is_endless(&self) -> bool {
        self.playback.is_endless() && self.has_output()
    }

    /// 是否有可产出的内容。一帧也没打过的效果不该出光。
    pub fn has_output(&self) -> bool {
        !self.frames.is_empty() && self.attributes.iter().any(|item| item.enabled)
    }

    /// 登记一个属性，已存在则沿用原设置。
    pub fn ensure_attribute(&mut self, attribute: &str, feature_group: &str) {
        if !self
            .attributes
            .iter()
            .any(|item| item.attribute == attribute)
        {
            self.attributes
                .push(EffectAttribute::new(attribute, feature_group));
        }
    }

    /// 打一帧：把给定的一组属性值记在某个角度上。
    ///
    /// 同一角度上已有帧就并入它，而不是叠一帧在同一位置 —— 两帧重合会让
    /// 曲线出现零长度的段。
    pub fn capture_frame(&mut self, angle: f64, values: Vec<FrameValue>) -> String {
        let angle = normalize_angle(angle);
        if let Some(existing) = self
            .frames
            .iter_mut()
            .find(|frame| (frame.angle - angle).abs() < 0.001)
        {
            for value in values {
                existing.set_value(&value.attribute, value.value);
            }
            return existing.id.clone();
        }

        let frame = Keyframe::capture(angle, values);
        let id = frame.id.clone();
        self.frames.push(frame);
        sort_frames(&mut self.frames);
        id
    }

    pub fn remove_frame(&mut self, frame_id: &str) {
        self.frames.retain(|frame| frame.id != frame_id);
    }

    /// 某个属性在各帧上的曲线采样点。
    fn curve_for(&self, attribute: &str) -> Vec<CurvePoint> {
        attribute_track(&self.frames, attribute)
            .into_iter()
            .map(|(angle, value, frame)| CurvePoint {
                angle,
                value,
                interpolation: frame.interpolation,
                handle_out: frame.handle_out,
                handle_in: frame.handle_in,
            })
            .collect()
    }

    /// 曲线的中值，作为幅度缩放的支点。
    fn center_of(&self, attribute: &str) -> f64 {
        let values = attribute_track(&self.frames, attribute);
        if values.is_empty() {
            return 0.0;
        }
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for (_, value, _) in &values {
            min = min.min(*value);
            max = max.max(*value);
        }
        if min.is_finite() && max.is_finite() {
            (min + max) / 2.0
        } else {
            0.0
        }
    }
}

/// 求值产出的一个值。
#[derive(Clone, Debug, PartialEq)]
pub struct EffectValue {
    pub fixture_id: String,
    pub attribute: String,
    pub feature_group: String,
    pub layer: TrackLayer,
    pub value: f64,
}

/// 一次求值的结果。
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EffectFrame {
    pub values: Vec<EffectValue>,
    /// 效果是否已跑完（Once / Repeat 用）。
    pub finished: bool,
}

/// 求某一时刻效果的输出。
///
/// `elapsed_ms` 是效果启动至今的时间，`fixtures` 来自效果实例 —— 顺序即
/// 相位铺开的次序。`overrides` 是实例上的临时调整：速度、相位、幅度。
pub fn evaluate(
    effect: &KeyframeEffect,
    elapsed_ms: f64,
    fixtures: &[String],
    overrides: EffectOverrides,
) -> EffectFrame {
    let mut frame = EffectFrame::default();
    if fixtures.is_empty() || !effect.has_output() {
        return frame;
    }

    let overrides = overrides.normalized();
    // rate 是倍率：快一倍等于周期短一半。
    let position = effect
        .playback
        .position(elapsed_ms * overrides.rate, effect.cycle_ms);
    frame.finished = position.finished;

    let mut phase = effect.phase;
    phase.spread *= overrides.spread_scale;

    // 每个启用的属性预先取出自己的曲线与中值，避免逐灯重算。
    let curves = effect
        .attributes
        .iter()
        .filter(|item| item.enabled)
        .map(|item| {
            (
                item,
                effect.curve_for(&item.attribute),
                effect.center_of(&item.attribute),
            )
        })
        .filter(|(_, points, _)| !points.is_empty())
        .collect::<Vec<_>>();

    let total = fixtures.len();
    frame.values.reserve(total * curves.len());
    for (index, fixture_id) in fixtures.iter().enumerate() {
        let angle = position.angle + phase.offset(index, total) + overrides.phase_offset;
        for (attribute, points, center) in &curves {
            let Some(raw) = sample_points(points, angle) else {
                continue;
            };
            frame.values.push(EffectValue {
                fixture_id: fixture_id.clone(),
                attribute: attribute.attribute.clone(),
                feature_group: attribute.feature_group.clone(),
                layer: attribute.layer,
                // 幅度围绕曲线自己的中值缩放：调小 size 是"起伏变小"，
                // 不是"整体压向零"。
                value: center + (raw - center) * overrides.size,
            });
        }
    }

    frame
}

/// 规整一个效果，使其可安全求值。
pub fn normalize_effect(mut effect: KeyframeEffect) -> KeyframeEffect {
    if effect.name.trim().is_empty() {
        effect.name = format!("Effect {}", effect.number.max(1));
    } else {
        effect.name = effect.name.trim().chars().take(96).collect();
    }
    // 周期钳在 10ms..10min：过小会让效果快到无法辨认，且把时钟拖满。
    effect.cycle_ms = if effect.cycle_ms.is_finite() {
        effect.cycle_ms.clamp(10.0, 600_000.0)
    } else {
        2000.0
    };
    effect.phase.spread = if effect.phase.spread.is_finite() {
        effect.phase.spread.clamp(-3600.0, 3600.0)
    } else {
        0.0
    };
    effect.phase.blocks = effect.phase.blocks.max(1);
    effect.phase.groups = effect.phase.groups.max(1);
    effect.phase.wings = effect.phase.wings.max(1);

    effect
        .attributes
        .retain(|item| !item.attribute.trim().is_empty());
    sort_frames(&mut effect.frames);

    // 帧里出现过、但没登记的属性补上登记，否则它永远不会被求值。
    for attribute in attributes_in(&effect.frames) {
        effect.ensure_attribute(&attribute, "");
    }
    effect
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn values(items: &[(&str, f64)]) -> Vec<FrameValue> {
        items
            .iter()
            .map(|(attribute, value)| FrameValue {
                attribute: attribute.to_string(),
                value: *value,
            })
            .collect()
    }

    /// 打两帧：红 → 蓝。这正是关键帧该表达的东西。
    fn red_to_blue() -> KeyframeEffect {
        let mut effect = KeyframeEffect::new(1, "Colour", 0);
        effect.cycle_ms = 1000.0;
        for attribute in ["ColorRGB_R", "ColorRGB_G", "ColorRGB_B"] {
            effect.ensure_attribute(attribute, "Color");
        }
        effect.capture_frame(
            0.0,
            values(&[("ColorRGB_R", 255.0), ("ColorRGB_G", 0.0), ("ColorRGB_B", 0.0)]),
        );
        effect.capture_frame(
            180.0,
            values(&[("ColorRGB_R", 0.0), ("ColorRGB_G", 0.0), ("ColorRGB_B", 255.0)]),
        );
        effect
    }

    fn run(effect: &KeyframeEffect, elapsed: f64, ids: &[&str]) -> EffectFrame {
        evaluate(effect, elapsed, &fixtures(ids), EffectOverrides::default())
    }

    fn value_of(frame: &EffectFrame, fixture: &str, attribute: &str) -> Option<f64> {
        frame
            .values
            .iter()
            .find(|value| value.fixture_id == fixture && value.attribute == attribute)
            .map(|value| value.value)
    }

    #[test]
    fn an_effect_with_no_frames_produces_nothing() {
        let mut effect = KeyframeEffect::new(1, "Empty", 0);
        effect.ensure_attribute("Dimmer", "Dimmer");
        assert!(run(&effect, 500.0, &["fix-1"]).values.is_empty());
    }

    #[test]
    fn a_captured_frame_is_reproduced_at_its_angle() {
        let effect = red_to_blue();
        let frame = run(&effect, 0.0, &["fix-1"]);

        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(255.0));
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(0.0));
    }

    #[test]
    fn colour_runs_from_the_first_frame_to_the_second() {
        let effect = red_to_blue();

        // 半个周期 = 180 度 = 第二帧：纯蓝。
        let frame = run(&effect, 500.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(0.0));
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(255.0));

        // 四分之一周期落在两帧之间，红蓝各半 —— 这才是"从红跑到蓝"。
        let frame = run(&effect, 250.0, &["fix-1"]);
        let red = value_of(&frame, "fix-1", "ColorRGB_R").unwrap();
        let blue = value_of(&frame, "fix-1", "ColorRGB_B").unwrap();
        assert!(red > 0.0 && red < 255.0, "红应在两帧之间，实际 {red}");
        assert!(blue > 0.0 && blue < 255.0, "蓝应在两帧之间，实际 {blue}");
    }

    #[test]
    fn all_attributes_of_a_frame_move_together() {
        // 一帧捕获的是一个颜色，三个分量必须同步推进，
        // 否则中途会出现原始素材里根本没有的颜色。
        let effect = red_to_blue();
        let frame = run(&effect, 250.0, &["fix-1"]);
        let red = value_of(&frame, "fix-1", "ColorRGB_R").unwrap();
        let blue = value_of(&frame, "fix-1", "ColorRGB_B").unwrap();
        assert!((red + blue - 255.0).abs() < 1.0, "两个分量应此消彼长");
    }

    #[test]
    fn a_third_frame_extends_the_run() {
        let mut effect = red_to_blue();
        // 中间插一帧绿色。
        effect.capture_frame(
            90.0,
            values(&[("ColorRGB_R", 0.0), ("ColorRGB_G", 255.0), ("ColorRGB_B", 0.0)]),
        );

        assert_eq!(effect.frames.len(), 3);
        let frame = run(&effect, 250.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_G"), Some(255.0));
    }

    #[test]
    fn capturing_at_an_existing_angle_merges_instead_of_stacking() {
        let mut effect = red_to_blue();
        effect.capture_frame(0.0, values(&[("Dimmer", 80.0)]));

        assert_eq!(effect.frames.len(), 2, "同角度应并入而不是叠一帧");
        assert_eq!(effect.frames[0].value_of("Dimmer"), Some(80.0));
        assert_eq!(effect.frames[0].value_of("ColorRGB_R"), Some(255.0));
    }

    #[test]
    fn frames_stay_sorted_by_angle() {
        let mut effect = KeyframeEffect::new(1, "Sorted", 0);
        effect.ensure_attribute("Dimmer", "Dimmer");
        effect.capture_frame(270.0, values(&[("Dimmer", 3.0)]));
        effect.capture_frame(90.0, values(&[("Dimmer", 1.0)]));
        effect.capture_frame(180.0, values(&[("Dimmer", 2.0)]));

        let angles = effect.frames.iter().map(|frame| frame.angle).collect::<Vec<_>>();
        assert_eq!(angles, vec![90.0, 180.0, 270.0]);
    }

    #[test]
    fn removing_a_frame_shortens_the_run() {
        let mut effect = red_to_blue();
        let id = effect.frames[1].id.clone();
        effect.remove_frame(&id);

        assert_eq!(effect.frames.len(), 1);
        // 只剩一帧就是恒定值，不再跑动。
        let early = value_of(&run(&effect, 0.0, &["fix-1"]), "fix-1", "ColorRGB_R");
        let late = value_of(&run(&effect, 500.0, &["fix-1"]), "fix-1", "ColorRGB_R");
        assert_eq!(early, late);
    }

    #[test]
    fn a_disabled_attribute_stops_being_driven_without_losing_its_frames() {
        let mut effect = red_to_blue();
        effect.attributes[0].enabled = false;

        let frame = run(&effect, 0.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), None);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(0.0));
        // 帧里的值还在，重新启用就能恢复，不用重打。
        assert_eq!(effect.frames[0].value_of("ColorRGB_R"), Some(255.0));
    }

    #[test]
    fn an_attribute_recorded_in_only_some_frames_still_runs() {
        // Pan 只在两帧里出现，Dimmer 在三帧里出现 —— 各按各的曲线跑。
        let mut effect = KeyframeEffect::new(1, "Mixed", 0);
        effect.cycle_ms = 1000.0;
        effect.ensure_attribute("Dimmer", "Dimmer");
        effect.ensure_attribute("Pan", "Position");
        effect.capture_frame(0.0, values(&[("Dimmer", 0.0)]));
        effect.capture_frame(120.0, values(&[("Dimmer", 100.0), ("Pan", -90.0)]));
        effect.capture_frame(240.0, values(&[("Dimmer", 50.0), ("Pan", 90.0)]));

        let frame = run(&effect, 0.0, &["fix-1"]);
        assert!(value_of(&frame, "fix-1", "Dimmer").is_some());
        assert!(value_of(&frame, "fix-1", "Pan").is_some());
    }

    #[test]
    fn position_frames_sweep_between_the_captured_orientations() {
        let mut effect = KeyframeEffect::new(1, "Sweep", 0);
        effect.cycle_ms = 1000.0;
        effect.ensure_attribute("Pan", "Position");
        effect.ensure_attribute("Tilt", "Position");
        effect.capture_frame(0.0, values(&[("Pan", -90.0), ("Tilt", 10.0)]));
        effect.capture_frame(180.0, values(&[("Pan", 90.0), ("Tilt", -10.0)]));

        assert_eq!(value_of(&run(&effect, 0.0, &["fix-1"]), "fix-1", "Pan"), Some(-90.0));
        assert_eq!(value_of(&run(&effect, 500.0, &["fix-1"]), "fix-1", "Pan"), Some(90.0));
        // 两个轴同时反向走，扫出的是一条斜线而不是各走各的。
        let mid = run(&effect, 250.0, &["fix-1"]);
        assert!(value_of(&mid, "fix-1", "Pan").unwrap().abs() < 90.0);
        assert!(value_of(&mid, "fix-1", "Tilt").unwrap().abs() < 10.0);
    }

    #[test]
    fn phase_offsets_stagger_the_fixtures() {
        let mut effect = red_to_blue();
        effect.phase = PhaseSpread {
            spread: 360.0,
            ..PhaseSpread::default()
        };

        // 两盏灯错开半圈：一盏红，另一盏蓝。
        let frame = run(&effect, 0.0, &["fix-1", "fix-2"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(255.0));
        assert_eq!(value_of(&frame, "fix-2", "ColorRGB_B"), Some(255.0));
    }

    #[test]
    fn cycle_time_controls_the_speed() {
        let mut fast = red_to_blue();
        fast.cycle_ms = 500.0;
        let slow = red_to_blue();

        // 同一时刻，周期短的走得更远（更接近蓝）。
        let fast_blue = value_of(&run(&fast, 125.0, &["fix-1"]), "fix-1", "ColorRGB_B").unwrap();
        let slow_blue = value_of(&run(&slow, 125.0, &["fix-1"]), "fix-1", "ColorRGB_B").unwrap();
        assert!(fast_blue > slow_blue);
    }

    #[test]
    fn a_finished_once_effect_reports_completion() {
        let mut effect = red_to_blue();
        effect.playback = PlaybackMode::Once;
        assert!(!run(&effect, 500.0, &["fix-1"]).finished);
        assert!(run(&effect, 1500.0, &["fix-1"]).finished);
    }

    #[test]
    fn a_template_is_reusable_across_different_fixture_sets() {
        let effect = red_to_blue();
        assert_eq!(run(&effect, 0.0, &["a"]).values.len(), 3);
        assert_eq!(run(&effect, 0.0, &["a", "b", "c"]).values.len(), 9);
    }

    #[test]
    fn rate_override_speeds_the_instance_up() {
        let effect = red_to_blue();
        let normal = run(&effect, 125.0, &["fix-1"]);
        let fast = evaluate(
            &effect,
            125.0,
            &fixtures(&["fix-1"]),
            EffectOverrides {
                rate: 2.0,
                ..EffectOverrides::default()
            },
        );
        assert!(
            value_of(&fast, "fix-1", "ColorRGB_B").unwrap()
                > value_of(&normal, "fix-1", "ColorRGB_B").unwrap()
        );
    }

    #[test]
    fn size_override_scales_around_the_curve_centre() {
        let mut effect = KeyframeEffect::new(1, "Dim", 0);
        effect.cycle_ms = 1000.0;
        effect.ensure_attribute("Dimmer", "Dimmer");
        effect.capture_frame(0.0, values(&[("Dimmer", 0.0)]));
        effect.capture_frame(180.0, values(&[("Dimmer", 100.0)]));

        // 曲线 0..100，中值 50。半幅后 180 度处应是 75。
        let scaled = evaluate(
            &effect,
            500.0,
            &fixtures(&["fix-1"]),
            EffectOverrides {
                size: 0.5,
                ..EffectOverrides::default()
            },
        );
        assert!((value_of(&scaled, "fix-1", "Dimmer").unwrap() - 75.0).abs() < 1e-9);
    }

    #[test]
    fn normalising_registers_attributes_that_only_exist_in_frames() {
        // 帧里出现过但没登记的属性要补上登记，否则永远不会被求值。
        let mut effect = KeyframeEffect::new(1, "Recovered", 0);
        effect.capture_frame(0.0, values(&[("Dimmer", 10.0)]));
        effect.capture_frame(180.0, values(&[("Dimmer", 90.0)]));

        let effect = normalize_effect(effect);
        assert!(effect.attributes.iter().any(|item| item.attribute == "Dimmer"));
        assert!(value_of(&run(&effect, 500.0, &["fix-1"]), "fix-1", "Dimmer").is_some());
    }

    #[test]
    fn normalising_clamps_the_cycle_and_sorts_frames() {
        let mut effect = red_to_blue();
        effect.cycle_ms = -5.0;
        effect.phase.blocks = 0;

        let effect = normalize_effect(effect);
        assert!(effect.cycle_ms >= 10.0);
        assert_eq!(effect.phase.blocks, 1);
        assert!(effect.frames[0].angle <= effect.frames[1].angle);
    }
}
