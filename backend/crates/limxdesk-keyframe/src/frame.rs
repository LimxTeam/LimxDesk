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
    /// 该属性的取值范围，打帧时从灯库读入。
    ///
    /// 记在轨道上而不是每次现查：曲线的纵轴、取值的钳制都要用它，而灯库
    /// 查询依赖当前选择 —— 换一批灯之后仍然要能正确编辑既有的效果。
    #[serde(default)]
    pub min_value: Option<f64>,
    #[serde(default)]
    pub max_value: Option<f64>,
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
            min_value: None,
            max_value: None,
            points: Vec::new(),
        }
    }

    /// 把取值钳进该属性的量程。
    ///
    /// 量程未知时原样返回 —— 宁可不限制，也不要拿一个猜出来的范围把
    /// 用户实际调出来的值截掉。
    pub fn clamp_value(&self, value: f64) -> f64 {
        if !value.is_finite() {
            return self.min_value.unwrap_or(0.0);
        }
        let mut clamped = value;
        if let Some(min) = self.min_value.filter(|min| min.is_finite()) {
            clamped = clamped.max(min);
        }
        if let Some(max) = self.max_value.filter(|max| max.is_finite()) {
            clamped = clamped.min(max);
        }
        clamped
    }

    /// 在某个角度记一个值。
    ///
    /// 同一角度上已有点就覆盖它，而不是叠一个在同一位置 —— 两点重合会让
    /// 曲线出现零长度的段。
    pub fn capture(&mut self, angle: f64, value: f64) -> String {
        let angle = normalize_angle(angle);
        let value = self.clamp_value(value);
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
        // 量程反了就换过来，否则钳制会把所有值挤成一个数。
        if let (Some(min), Some(max)) = (self.min_value, self.max_value) {
            if min > max {
                self.min_value = Some(max);
                self.max_value = Some(min);
            }
        }

        let (min, max) = (self.min_value, self.max_value);
        for point in self.points.iter_mut() {
            point.angle = normalize_angle(point.angle);
            if point.id.trim().is_empty() {
                point.id = Uuid::new_v4().to_string();
            }
            if point.value.is_finite() {
                if let Some(min) = min.filter(|min| min.is_finite()) {
                    point.value = point.value.max(min);
                }
                if let Some(max) = max.filter(|max| max.is_finite()) {
                    point.value = point.value.min(max);
                }
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
    /// 该属性的量程，来自灯库。
    #[serde(default)]
    pub min_value: Option<f64>,
    #[serde(default)]
    pub max_value: Option<f64>,
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
    fn captured_values_are_clamped_to_the_attribute_range() {
        let mut track = KeyframeTrack::new("Dimmer", "Dimmer");
        track.min_value = Some(0.0);
        track.max_value = Some(100.0);

        track.capture(0.0, 150.0);
        track.capture(180.0, -20.0);

        assert_eq!(track.points[0].value, 100.0);
        assert_eq!(track.points[1].value, 0.0);
    }

    #[test]
    fn sorting_clamps_values_that_arrived_out_of_range() {
        // 存档里可能带着超范围的值（旧版本、手改过的文件）。
        let mut track = KeyframeTrack::new("Dimmer", "Dimmer");
        track.min_value = Some(0.0);
        track.max_value = Some(100.0);
        track.points.push(TrackPoint::new(0.0, 102.5));
        track.sort();

        assert_eq!(track.points[0].value, 100.0);
    }

    #[test]
    fn an_unknown_range_leaves_values_alone() {
        // 量程未知时宁可不限制，也不要拿猜出来的范围截掉用户调出来的值。
        let mut track = KeyframeTrack::new("Custom", "Other");
        track.capture(0.0, 9999.0);
        assert_eq!(track.points[0].value, 9999.0);
    }

    #[test]
    fn a_reversed_range_is_corrected_rather_than_collapsing_values() {
        let mut track = KeyframeTrack::new("Pan", "Position");
        track.min_value = Some(270.0);
        track.max_value = Some(-270.0);
        track.points.push(TrackPoint::new(0.0, 0.0));
        track.sort();

        assert_eq!(track.min_value, Some(-270.0));
        assert_eq!(track.max_value, Some(270.0));
        assert_eq!(track.points[0].value, 0.0);
    }

    #[test]
    fn a_one_sided_range_clamps_only_that_side() {
        let mut track = KeyframeTrack::new("Speed", "Control");
        track.min_value = Some(0.0);
        track.capture(0.0, -5.0);
        track.capture(90.0, 1000.0);

        assert_eq!(track.points[0].value, 0.0);
        assert_eq!(track.points[1].value, 1000.0);
    }

    #[test]
    fn non_finite_values_are_dropped_on_sort() {
        let mut track = track_with(&[(0.0, 10.0)]);
        track.points.push(TrackPoint::new(180.0, f64::NAN));
        track.sort();
        assert_eq!(track.points.len(), 1);
    }
}
