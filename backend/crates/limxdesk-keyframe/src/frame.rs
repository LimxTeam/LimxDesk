// ============================================================
// 文件名称：frame.rs
// 功能描述：轨道与关键点 —— 每个属性一条独立的时间线
//
// 关键帧记录的是"打帧那一刻编程器里的值"，不是算出来的曲线。调成红色打
// 一帧、调成蓝色再打一帧，效果就从红跑到蓝。
//
// 捕获是跨属性的一次动作：按下打帧，此刻所有激活属性一起被记下，因为红色
// 是 R/G/B 三个值同时成立的一件事。但记下之后，每个属性有自己独立的一条
// 时间线 —— 亮度可以只用两个点，颜色用四个点，挪动亮度的点不该连带拖走
// 颜色。捕获的原子性说的是"同时记录"，不是"从此绑死在同一角度"。
// ============================================================

use crate::curve::{normalize_angle, CurvePoint, Handle, Interpolation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 一条轨道上的一个关键点。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackPoint {
    pub id: String,
    /// 在周期中的位置，0..360 度。
    pub angle: f64,
    /// 捕获时该属性的值。
    pub value: f64,
    /// 从本点到下一点的过渡方式。
    pub interpolation: Interpolation,
    pub handle_out: Handle,
    pub handle_in: Handle,
}

impl TrackPoint {
    pub fn new(angle: f64, value: f64) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            angle: normalize_angle(angle),
            value,
            interpolation: Interpolation::Smooth,
            handle_out: Handle::default(),
            handle_in: Handle::default(),
        }
    }

    pub fn as_curve_point(&self) -> CurvePoint {
        CurvePoint {
            angle: self.angle,
            value: self.value,
            interpolation: self.interpolation,
            handle_out: self.handle_out,
            handle_in: self.handle_in,
        }
    }
}

/// 一条驱动单个属性的轨道。
///
/// 每个属性一条，各自拥有独立的关键点序列与时间分布。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeTrack {
    pub id: String,
    pub attribute: String,
    pub feature_group: String,
    pub layer: crate::TrackLayer,
    pub enabled: bool,
    pub points: Vec<TrackPoint>,
}

impl KeyframeTrack {
    pub fn new(attribute: impl Into<String>, feature_group: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            attribute: attribute.into(),
            feature_group: feature_group.into(),
            layer: crate::TrackLayer::Absolute,
            enabled: true,
            points: Vec::new(),
        }
    }

    /// 在某个角度记一个值。
    ///
    /// 同一角度上已有点就覆盖它，而不是叠一个在同一位置 —— 两点重合会让
    /// 曲线出现零长度的段。
    pub fn capture(&mut self, angle: f64, value: f64) -> String {
        let angle = normalize_angle(angle);
        if let Some(existing) = self
            .points
            .iter_mut()
            .find(|point| (point.angle - angle).abs() < 0.001)
        {
            existing.value = value;
            return existing.id.clone();
        }

        let point = TrackPoint::new(angle, value);
        let id = point.id.clone();
        self.points.push(point);
        self.sort();
        id
    }

    pub fn remove_point(&mut self, point_id: &str) {
        self.points.retain(|point| point.id != point_id);
    }

    pub fn point(&self, point_id: &str) -> Option<&TrackPoint> {
        self.points.iter().find(|point| point.id == point_id)
    }

    pub fn point_mut(&mut self, point_id: &str) -> Option<&mut TrackPoint> {
        self.points.iter_mut().find(|point| point.id == point_id)
    }

    pub fn curve(&self) -> Vec<CurvePoint> {
        self.points.iter().map(TrackPoint::as_curve_point).collect()
    }

    /// 曲线的中值，作为幅度缩放的支点。
    pub fn center(&self) -> f64 {
        if self.points.is_empty() {
            return 0.0;
        }
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for point in &self.points {
            min = min.min(point.value);
            max = max.max(point.value);
        }
        if min.is_finite() && max.is_finite() {
            (min + max) / 2.0
        } else {
            0.0
        }
    }

    pub fn sort(&mut self) {
        for point in self.points.iter_mut() {
            point.angle = normalize_angle(point.angle);
            if point.id.trim().is_empty() {
                point.id = Uuid::new_v4().to_string();
            }
        }
        self.points.retain(|point| point.value.is_finite());
        self.points.sort_by(|left, right| left.angle.total_cmp(&right.angle));
    }
}

/// 一次跨属性捕获里的单个取值。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameValue {
    pub attribute: String,
    pub feature_group: String,
    pub value: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track_with(points: &[(f64, f64)]) -> KeyframeTrack {
        let mut track = KeyframeTrack::new("Dimmer", "Dimmer");
        for (angle, value) in points {
            track.capture(*angle, *value);
        }
        track
    }

    #[test]
    fn capturing_adds_a_point_at_the_angle() {
        let track = track_with(&[(0.0, 0.0), (180.0, 100.0)]);
        assert_eq!(track.points.len(), 2);
        assert_eq!(track.points[0].value, 0.0);
        assert_eq!(track.points[1].value, 100.0);
    }

    #[test]
    fn capturing_at_an_existing_angle_overwrites() {
        let mut track = track_with(&[(0.0, 10.0)]);
        track.capture(0.0, 90.0);
        assert_eq!(track.points.len(), 1, "同角度应覆盖而不是叠一个点");
        assert_eq!(track.points[0].value, 90.0);
    }

    #[test]
    fn points_stay_sorted_by_angle() {
        let track = track_with(&[(270.0, 3.0), (90.0, 1.0), (180.0, 2.0)]);
        let angles = track.points.iter().map(|point| point.angle).collect::<Vec<_>>();
        assert_eq!(angles, vec![90.0, 180.0, 270.0]);
    }

    #[test]
    fn angles_normalise_into_one_cycle() {
        let track = track_with(&[(400.0, 1.0)]);
        assert_eq!(track.points[0].angle, 40.0);
    }

    #[test]
    fn removing_a_point_leaves_the_rest() {
        let mut track = track_with(&[(0.0, 1.0), (180.0, 2.0)]);
        let id = track.points[0].id.clone();
        track.remove_point(&id);
        assert_eq!(track.points.len(), 1);
        assert_eq!(track.points[0].value, 2.0);
    }

    #[test]
    fn the_centre_sits_between_the_extremes() {
        let track = track_with(&[(0.0, 20.0), (180.0, 80.0)]);
        assert_eq!(track.center(), 50.0);
    }

    #[test]
    fn an_empty_track_has_a_zero_centre() {
        assert_eq!(KeyframeTrack::new("Pan", "Position").center(), 0.0);
    }

    #[test]
    fn non_finite_values_are_dropped_on_sort() {
        let mut track = track_with(&[(0.0, 10.0)]);
        track.points.push(TrackPoint::new(180.0, f64::NAN));
        track.sort();
        assert_eq!(track.points.len(), 1);
    }
}
