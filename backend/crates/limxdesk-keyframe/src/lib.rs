// ============================================================
// 文件名称：lib.rs
// 功能描述：关键帧效果 —— LimxDesk 效果体系中的一种
//
// 一个效果由若干条轨道组成，每条轨道驱动一个属性，轨道上是一条环形的
// 关键帧曲线：整圈 360 度，末帧接回首帧。速度用"跑完一圈要多久"表达；
// 灯与灯之间靠相位错开。
//
//   curve     曲线本身与插值
//   playback  时间 → 周期角度（循环 / 反弹 / 倒放 / 单次 / 定次）
//   phase     一组灯之间怎么错开
//   library   可复用的效果集合
//
// 这个 crate 只管求值，不知道 DMX、不知道回放引擎。接线在 engine 侧。
// ============================================================

pub mod curve;
pub mod library;
pub mod phase;
pub mod playback;

pub use curve::{normalize_angle, sample, sort_keyframes, Handle, Interpolation, Keyframe, CYCLE_DEGREES};
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
    /// 曲线值就是最终值。
    #[default]
    Absolute,
    /// 曲线值是相对当前基准的偏移，叠加在回放之上。
    Relative,
}

/// 一条驱动单个属性的轨道。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeTrack {
    pub id: String,
    pub attribute: String,
    pub feature_group: String,
    pub layer: TrackLayer,
    pub enabled: bool,
    pub keyframes: Vec<Keyframe>,
}

impl KeyframeTrack {
    /// 建一条默认的首尾帧轨道：0 度到 180 度走一个来回。
    ///
    /// 这是"打首尾帧"最常见的起点 —— 曲线闭环，180..360 自动走回来。
    pub fn new(attribute: impl Into<String>, feature_group: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            attribute: attribute.into(),
            feature_group: feature_group.into(),
            layer: TrackLayer::Absolute,
            enabled: true,
            keyframes: vec![
                Keyframe::new(0.0, 0.0).with_interpolation(Interpolation::Smooth),
                Keyframe::new(180.0, 100.0).with_interpolation(Interpolation::Smooth),
            ],
        }
    }

    pub fn value_at(&self, angle: f64) -> f64 {
        sample(&self.keyframes, angle)
    }

    /// 曲线的中值，作为幅度缩放的支点。
    pub fn center(&self) -> f64 {
        if self.keyframes.is_empty() {
            return 0.0;
        }
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for keyframe in &self.keyframes {
            min = min.min(keyframe.value);
            max = max.max(keyframe.value);
        }
        if min.is_finite() && max.is_finite() {
            (min + max) / 2.0
        } else {
            0.0
        }
    }
}

/// 一个关键帧效果模板。
///
/// 只描述形状、速度与相位规则，不含灯具 —— 作用于谁由效果实例
/// （limxdesk-effect 的 AppliedEffect）决定。模板因此可以被任意多处复用，
/// 改一次处处生效。
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
        self.playback.is_endless() && self.has_tracks()
    }

    /// 模板是否有可产出的轨道。作用于哪些灯由实例决定，与模板无关。
    pub fn has_tracks(&self) -> bool {
        self.tracks
            .iter()
            .any(|track| track.enabled && !track.keyframes.is_empty())
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
    if fixtures.is_empty() || !effect.has_tracks() {
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

    let total = fixtures.len();
    let tracks = effect
        .tracks
        .iter()
        .filter(|track| track.enabled && !track.keyframes.is_empty())
        .collect::<Vec<_>>();

    // 幅度围绕各轨道自己的中值缩放，这样调小 size 是"起伏变小"，
    // 而不是"整体压向零"。
    let centers = tracks.iter().map(|track| track.center()).collect::<Vec<_>>();

    frame.values.reserve(total * tracks.len());
    for (index, fixture_id) in fixtures.iter().enumerate() {
        let angle = position.angle + phase.offset(index, total) + overrides.phase_offset;
        for (track, center) in tracks.iter().zip(centers.iter()) {
            let raw = track.value_at(angle);
            frame.values.push(EffectValue {
                fixture_id: fixture_id.clone(),
                attribute: track.attribute.clone(),
                feature_group: track.feature_group.clone(),
                layer: track.layer,
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

    effect.tracks.retain(|track| !track.attribute.trim().is_empty());
    for track in effect.tracks.iter_mut() {
        if track.id.trim().is_empty() {
            track.id = Uuid::new_v4().to_string();
        }
        sort_keyframes(&mut track.keyframes);
    }
    effect
}

#[cfg(test)]
mod tests {
    use super::*;

    fn template(tracks: Vec<KeyframeTrack>) -> KeyframeEffect {
        let mut effect = KeyframeEffect::new(1, "Test", 0);
        effect.tracks = tracks;
        effect.cycle_ms = 1000.0;
        effect
    }

    fn fixtures(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    fn run(effect: &KeyframeEffect, elapsed: f64, ids: &[&str]) -> EffectFrame {
        evaluate(effect, elapsed, &fixtures(ids), EffectOverrides::default())
    }

    fn linear_track() -> KeyframeTrack {
        let mut track = KeyframeTrack::new("Dimmer", "Dimmer");
        track.keyframes = vec![Keyframe::new(0.0, 0.0), Keyframe::new(180.0, 100.0)];
        track
    }

    fn value_for(frame: &EffectFrame, fixture: &str) -> Option<f64> {
        frame
            .values
            .iter()
            .find(|value| value.fixture_id == fixture)
            .map(|value| value.value)
    }

    #[test]
    fn an_instance_without_fixtures_produces_nothing() {
        let effect = template(vec![linear_track()]);
        assert!(run(&effect, 500.0, &[]).values.is_empty());
    }

    #[test]
    fn a_template_without_tracks_produces_nothing() {
        let effect = template(Vec::new());
        assert!(run(&effect, 500.0, &["fix-1"]).values.is_empty());
    }

    #[test]
    fn a_disabled_track_is_skipped() {
        let mut track = linear_track();
        track.enabled = false;
        let effect = template(vec![track]);
        assert!(run(&effect, 500.0, &["fix-1"]).values.is_empty());
    }

    #[test]
    fn the_curve_is_sampled_at_the_current_angle() {
        let effect = template(vec![linear_track()]);
        // 四分之一周期 = 90 度 = 线性段的中点。
        let frame = run(&effect, 250.0, &["fix-1"]);
        assert!((value_for(&frame, "fix-1").unwrap() - 50.0).abs() < 1e-9);
    }

    #[test]
    fn phase_offsets_stagger_the_fixtures() {
        let mut effect = template(vec![linear_track()]);
        effect.phase = PhaseSpread {
            spread: 360.0,
            ..PhaseSpread::default()
        };

        // 两盏灯错开半圈：一盏在 0 度取 0，另一盏在 180 度取 100。
        let frame = run(&effect, 0.0, &["fix-1", "fix-2"]);
        assert!((value_for(&frame, "fix-1").unwrap() - 0.0).abs() < 1e-9);
        assert!((value_for(&frame, "fix-2").unwrap() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn every_fixture_gets_a_value_from_every_enabled_track() {
        let mut second = KeyframeTrack::new("Pan", "Position");
        second.keyframes = vec![Keyframe::new(0.0, 10.0)];
        let effect = template(vec![linear_track(), second]);

        let frame = run(&effect, 0.0, &["fix-1", "fix-2"]);
        assert_eq!(frame.values.len(), 4);
        assert_eq!(
            frame
                .values
                .iter()
                .filter(|value| value.attribute == "Pan")
                .count(),
            2
        );
    }

    #[test]
    fn cycle_time_controls_the_speed() {
        let mut fast = template(vec![linear_track()]);
        fast.cycle_ms = 500.0;
        let mut slow = template(vec![linear_track()]);
        slow.cycle_ms = 2000.0;

        // 同一时刻，周期短的走得更远。
        let fast_value = value_for(&run(&fast, 125.0, &["fix-1"]), "fix-1").unwrap();
        let slow_value = value_for(&run(&slow, 125.0, &["fix-1"]), "fix-1").unwrap();
        assert!(fast_value > slow_value, "{fast_value} 应大于 {slow_value}");
    }

    #[test]
    fn a_finished_once_effect_reports_completion() {
        let mut effect = template(vec![linear_track()]);
        effect.playback = PlaybackMode::Once;
        assert!(!run(&effect, 500.0, &["fix-1"]).finished);
        assert!(run(&effect, 1500.0, &["fix-1"]).finished);
    }

    #[test]
    fn endlessness_requires_both_a_looping_mode_and_tracks() {
        let mut effect = template(vec![linear_track()]);
        assert!(effect.is_endless());

        effect.playback = PlaybackMode::Once;
        assert!(!effect.is_endless());

        effect.playback = PlaybackMode::Loop;
        effect.tracks.clear();
        assert!(!effect.is_endless(), "没有轨道就不该让时钟一直转");
    }

    #[test]
    fn a_template_is_reusable_across_different_fixture_sets() {
        // 模板不含灯具，同一份可以给任意几组灯用 —— 这正是它作为模板的意义。
        let effect = template(vec![linear_track()]);
        assert_eq!(run(&effect, 0.0, &["a"]).values.len(), 1);
        assert_eq!(run(&effect, 0.0, &["a", "b", "c"]).values.len(), 3);
    }

    #[test]
    fn rate_override_speeds_the_instance_up() {
        let effect = template(vec![linear_track()]);
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
            value_for(&fast, "fix-1").unwrap() > value_for(&normal, "fix-1").unwrap(),
            "速度倍率应让实例走得更快"
        );
    }

    #[test]
    fn phase_offset_override_shifts_the_whole_instance() {
        let effect = template(vec![linear_track()]);
        let shifted = evaluate(
            &effect,
            0.0,
            &fixtures(&["fix-1"]),
            EffectOverrides {
                phase_offset: 90.0,
                ..EffectOverrides::default()
            },
        );
        // 起点整体挪到 90 度：线性段的中点。
        assert!((value_for(&shifted, "fix-1").unwrap() - 50.0).abs() < 1e-9);
    }

    #[test]
    fn size_override_scales_around_the_curve_centre() {
        let effect = template(vec![linear_track()]);
        // 曲线 0..100，中值 50。半幅后 180 度处应是 75，而不是压向零。
        let scaled = evaluate(
            &effect,
            500.0,
            &fixtures(&["fix-1"]),
            EffectOverrides {
                size: 0.5,
                ..EffectOverrides::default()
            },
        );
        assert!((value_for(&scaled, "fix-1").unwrap() - 75.0).abs() < 1e-9);
    }

    #[test]
    fn normalising_clamps_the_cycle_and_orders_keyframes() {
        let mut effect = template(vec![linear_track()]);
        effect.cycle_ms = -5.0;
        effect.phase.blocks = 0;
        effect.tracks[0].keyframes = vec![Keyframe::new(200.0, 1.0), Keyframe::new(20.0, 2.0)];

        let effect = normalize_effect(effect);

        assert!(effect.cycle_ms >= 10.0);
        assert_eq!(effect.phase.blocks, 1);
        assert_eq!(effect.tracks[0].keyframes[0].angle, 20.0);
    }

    #[test]
    fn a_default_track_makes_a_closed_loop() {
        // 打首尾两帧就该得到完整的往复：0 度起、180 度到顶、绕回 0。
        let track = KeyframeTrack::new("Dimmer", "Dimmer");
        assert!((track.value_at(0.0) - 0.0).abs() < 1e-9);
        assert!((track.value_at(180.0) - 100.0).abs() < 1e-9);
        assert!((track.value_at(90.0) - 50.0).abs() < 1.0);
        assert!((track.value_at(270.0) - 50.0).abs() < 1.0);
        assert!(track.value_at(359.0) < 2.0);
    }
}
