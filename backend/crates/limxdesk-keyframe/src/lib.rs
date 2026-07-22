// ============================================================
// 文件名称：lib.rs
// 功能描述：关键帧效果 —— LimxDesk 效果体系中的一种
//
// 关键帧记录的是"打帧那一刻编程器里的值"。把灯调成红色打一帧、调成蓝色
// 再打一帧，效果就在红蓝之间跑；位置同理，打两个朝向就在两者之间扫。
// 这里不替用户决定跑什么 —— 那是预制效果的事。
//
// 捕获是跨属性的一次动作（红色是 R/G/B 同时成立），但每个属性各有一条
// 独立的轨道：亮度可以只用两个点、颜色用四个，挪动亮度的点不会连带
// 拖走颜色。
//
//   frame     轨道与关键点
//   curve     两点之间怎么过渡
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
pub use frame::{FrameValue, KeyframeTrack, TrackPoint};
pub use library::{KeyframeLibrary, KeyframeLibraryDocument};
pub use phase::PhaseSpread;
pub use playback::{CyclePosition, PlaybackMode};

use limxdesk_effect::EffectOverrides;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 轨道产出的值怎么进入合成。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrackLayer {
    /// 记录的值就是最终值。
    #[default]
    Absolute,
    /// 记录的值是相对基准的偏移，叠加在回放之上。
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
    /// 每个属性一条轨道，各自拥有独立的时间分布。
    pub tracks: Vec<KeyframeTrack>,
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
            tracks: Vec::new(),
            updated_at_ms: now_ms,
        }
    }

    /// 该效果是否会一直动下去。用来决定回放时钟能不能停。
    pub fn is_endless(&self) -> bool {
        self.playback.is_endless() && self.has_output()
    }

    /// 是否有可产出的内容。一个点也没打过的效果不该出光。
    pub fn has_output(&self) -> bool {
        self.tracks
            .iter()
            .any(|track| track.enabled && !track.points.is_empty())
    }

    pub fn track(&self, attribute: &str) -> Option<&KeyframeTrack> {
        self.tracks.iter().find(|track| track.attribute == attribute)
    }

    pub fn track_mut(&mut self, attribute: &str) -> Option<&mut KeyframeTrack> {
        self.tracks
            .iter_mut()
            .find(|track| track.attribute == attribute)
    }

    /// 取得属性对应的轨道，没有就建一条。
    pub fn ensure_track(&mut self, attribute: &str, feature_group: &str) -> &mut KeyframeTrack {
        if self.track(attribute).is_none() {
            self.tracks
                .push(KeyframeTrack::new(attribute, feature_group));
        }
        self.track_mut(attribute).expect("track just ensured")
    }

    /// 打一帧：把一组属性值同时记在某个角度上。
    ///
    /// 记录是跨属性的一次动作，但每个值落进各自的轨道 —— 之后调整任一
    /// 属性的时间分布都不会牵动其他属性。
    pub fn capture(&mut self, angle: f64, values: &[FrameValue]) {
        for value in values {
            if !value.value.is_finite() {
                continue;
            }
            let track = self.ensure_track(&value.attribute, &value.feature_group);
            // 量程随捕获一起记下：之后编辑要靠它钳值，也靠它决定曲线纵轴。
            // 已有量程不覆盖 —— 换一批灯不该悄悄改掉既有效果的边界。
            if track.min_value.is_none() {
                track.min_value = value.min_value;
            }
            if track.max_value.is_none() {
                track.max_value = value.max_value;
            }
            track.capture(angle, value.value);
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

    // 每条轨道预先取出曲线与中值，避免逐灯重算。
    let curves = effect
        .tracks
        .iter()
        .filter(|track| track.enabled && !track.points.is_empty())
        .map(|track| (track, track.curve(), track.center()))
        .collect::<Vec<_>>();

    let total = fixtures.len();
    frame.values.reserve(total * curves.len());
    for (index, fixture_id) in fixtures.iter().enumerate() {
        let angle = position.angle + phase.offset(index, total) + overrides.phase_offset;
        for (track, points, center) in &curves {
            let Some(raw) = sample_points(points, angle) else {
                continue;
            };
            frame.values.push(EffectValue {
                fixture_id: fixture_id.clone(),
                attribute: track.attribute.clone(),
                feature_group: track.feature_group.clone(),
                layer: track.layer,
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
        .tracks
        .retain(|track| !track.attribute.trim().is_empty());
    for track in effect.tracks.iter_mut() {
        if track.id.trim().is_empty() {
            track.id = Uuid::new_v4().to_string();
        }
        track.sort();
    }
    effect
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn values(items: &[(&str, &str, f64)]) -> Vec<FrameValue> {
        items
            .iter()
            .map(|(attribute, group, value)| FrameValue {
                attribute: attribute.to_string(),
                feature_group: group.to_string(),
                value: *value,
                min_value: None,
                max_value: None,
            })
            .collect()
    }

    /// 打两帧：红 → 蓝。
    fn red_to_blue() -> KeyframeEffect {
        let mut effect = KeyframeEffect::new(1, "Colour", 0);
        effect.cycle_ms = 1000.0;
        effect.capture(
            0.0,
            &values(&[
                ("ColorRGB_R", "Color", 255.0),
                ("ColorRGB_G", "Color", 0.0),
                ("ColorRGB_B", "Color", 0.0),
            ]),
        );
        effect.capture(
            180.0,
            &values(&[
                ("ColorRGB_R", "Color", 0.0),
                ("ColorRGB_G", "Color", 0.0),
                ("ColorRGB_B", "Color", 255.0),
            ]),
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
    fn an_effect_with_no_points_produces_nothing() {
        let effect = KeyframeEffect::new(1, "Empty", 0);
        assert!(run(&effect, 500.0, &["fix-1"]).values.is_empty());
    }

    #[test]
    fn a_captured_value_is_reproduced_at_its_angle() {
        let effect = red_to_blue();
        let frame = run(&effect, 0.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(255.0));
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(0.0));
    }

    #[test]
    fn colour_runs_from_the_first_capture_to_the_second() {
        let effect = red_to_blue();

        let frame = run(&effect, 500.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(0.0));
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(255.0));

        let frame = run(&effect, 250.0, &["fix-1"]);
        let red = value_of(&frame, "fix-1", "ColorRGB_R").unwrap();
        let blue = value_of(&frame, "fix-1", "ColorRGB_B").unwrap();
        assert!(red > 0.0 && red < 255.0, "红应在两帧之间，实际 {red}");
        assert!((red + blue - 255.0).abs() < 1.0, "两个分量应此消彼长");
    }

    #[test]
    fn one_capture_writes_into_each_attributes_own_track() {
        // 捕获是跨属性的一次动作，但落进的是各自的轨道。
        let effect = red_to_blue();
        assert_eq!(effect.tracks.len(), 3);
        for track in &effect.tracks {
            assert_eq!(track.points.len(), 2);
        }
    }

    #[test]
    fn moving_one_attributes_point_leaves_the_others_alone() {
        // 这是轨道独立的意义所在：挪亮度的点不该连带拖走颜色。
        let mut effect = red_to_blue();
        effect.capture(0.0, &values(&[("Dimmer", "Dimmer", 50.0)]));
        effect.capture(180.0, &values(&[("Dimmer", "Dimmer", 100.0)]));

        let point_id = effect.track("Dimmer").unwrap().points[1].id.clone();
        effect
            .track_mut("Dimmer")
            .unwrap()
            .point_mut(&point_id)
            .unwrap()
            .angle = 90.0;
        effect.track_mut("Dimmer").unwrap().sort();

        // 亮度的第二个点挪到 90 度。
        let dimmer_angles = effect
            .track("Dimmer")
            .unwrap()
            .points
            .iter()
            .map(|point| point.angle)
            .collect::<Vec<_>>();
        assert_eq!(dimmer_angles, vec![0.0, 90.0]);

        // 颜色的点纹丝不动。
        let red_angles = effect
            .track("ColorRGB_R")
            .unwrap()
            .points
            .iter()
            .map(|point| point.angle)
            .collect::<Vec<_>>();
        assert_eq!(red_angles, vec![0.0, 180.0]);

        // 求值也跟着分开：90 度处亮度已到顶，颜色才走到一半。
        let frame = run(&effect, 250.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "Dimmer"), Some(100.0));
        let red = value_of(&frame, "fix-1", "ColorRGB_R").unwrap();
        assert!(red > 0.0 && red < 255.0);
    }

    #[test]
    fn attributes_can_have_different_point_counts() {
        // 亮度两个点、颜色四个点，各跑各的。
        let mut effect = KeyframeEffect::new(1, "Mixed", 0);
        effect.cycle_ms = 1000.0;
        effect.capture(0.0, &values(&[("Dimmer", "Dimmer", 0.0)]));
        effect.capture(180.0, &values(&[("Dimmer", "Dimmer", 100.0)]));
        for (index, angle) in [0.0, 90.0, 180.0, 270.0].iter().enumerate() {
            effect.capture(
                *angle,
                &values(&[("ColorRGB_R", "Color", (index * 60) as f64)]),
            );
        }

        assert_eq!(effect.track("Dimmer").unwrap().points.len(), 2);
        assert_eq!(effect.track("ColorRGB_R").unwrap().points.len(), 4);

        let frame = run(&effect, 250.0, &["fix-1"]);
        assert!(value_of(&frame, "fix-1", "Dimmer").is_some());
        assert!(value_of(&frame, "fix-1", "ColorRGB_R").is_some());
    }

    #[test]
    fn a_later_capture_extends_only_the_attributes_it_names() {
        let mut effect = red_to_blue();
        effect.capture(90.0, &values(&[("ColorRGB_G", "Color", 255.0)]));

        assert_eq!(effect.track("ColorRGB_G").unwrap().points.len(), 3);
        assert_eq!(effect.track("ColorRGB_R").unwrap().points.len(), 2);
    }

    #[test]
    fn capturing_at_an_existing_angle_overwrites_that_point() {
        let mut effect = red_to_blue();
        effect.capture(0.0, &values(&[("ColorRGB_R", "Color", 12.0)]));

        let track = effect.track("ColorRGB_R").unwrap();
        assert_eq!(track.points.len(), 2, "同角度应覆盖而不是叠一个点");
        assert_eq!(track.points[0].value, 12.0);
    }

    #[test]
    fn removing_a_point_shortens_only_that_track() {
        let mut effect = red_to_blue();
        let id = effect.track("ColorRGB_R").unwrap().points[1].id.clone();
        effect.track_mut("ColorRGB_R").unwrap().remove_point(&id);

        assert_eq!(effect.track("ColorRGB_R").unwrap().points.len(), 1);
        assert_eq!(effect.track("ColorRGB_B").unwrap().points.len(), 2);
    }

    #[test]
    fn a_disabled_track_stops_being_driven_without_losing_its_points() {
        let mut effect = red_to_blue();
        effect.tracks[0].enabled = false;

        let frame = run(&effect, 0.0, &["fix-1"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), None);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_B"), Some(0.0));
        // 点还在，重新启用就能恢复，不用重打。
        assert_eq!(effect.tracks[0].points.len(), 2);
    }

    #[test]
    fn position_captures_sweep_between_the_recorded_orientations() {
        let mut effect = KeyframeEffect::new(1, "Sweep", 0);
        effect.cycle_ms = 1000.0;
        effect.capture(
            0.0,
            &values(&[("Pan", "Position", -90.0), ("Tilt", "Position", 10.0)]),
        );
        effect.capture(
            180.0,
            &values(&[("Pan", "Position", 90.0), ("Tilt", "Position", -10.0)]),
        );

        assert_eq!(value_of(&run(&effect, 0.0, &["fix-1"]), "fix-1", "Pan"), Some(-90.0));
        assert_eq!(value_of(&run(&effect, 500.0, &["fix-1"]), "fix-1", "Pan"), Some(90.0));
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

        let frame = run(&effect, 0.0, &["fix-1", "fix-2"]);
        assert_eq!(value_of(&frame, "fix-1", "ColorRGB_R"), Some(255.0));
        assert_eq!(value_of(&frame, "fix-2", "ColorRGB_B"), Some(255.0));
    }

    #[test]
    fn cycle_time_controls_the_speed() {
        let mut fast = red_to_blue();
        fast.cycle_ms = 500.0;
        let slow = red_to_blue();

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
        effect.capture(0.0, &values(&[("Dimmer", "Dimmer", 0.0)]));
        effect.capture(180.0, &values(&[("Dimmer", "Dimmer", 100.0)]));

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
    fn normalising_clamps_the_cycle_and_sorts_points() {
        let mut effect = red_to_blue();
        effect.cycle_ms = -5.0;
        effect.phase.blocks = 0;

        let effect = normalize_effect(effect);
        assert!(effect.cycle_ms >= 10.0);
        assert_eq!(effect.phase.blocks, 1);
        let points = &effect.tracks[0].points;
        assert!(points[0].angle <= points[1].angle);
    }
}
