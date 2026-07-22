// ============================================================
// 文件名称：curve.rs
// 功能描述：关键帧曲线求值
//
// 一个效果周期就是一整圈 360 度，曲线因此是环形的：最后一个关键帧接回
// 第一个，跨过 0 度。用户只打首尾两帧时，得到的是一条从首值到尾值、
// 再绕回首值的完整闭环。
// ============================================================

use serde::{Deserialize, Serialize};

/// 一个周期的角度跨度。
pub const CYCLE_DEGREES: f64 = 360.0;

/// 关键帧之间的过渡方式。
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Interpolation {
    /// 保持前一帧的值直到下一帧，产生硬切。
    Step,
    #[default]
    Linear,
    /// 两端速度为零的平滑过渡，适合呼吸一类的往复。
    Smooth,
    /// 由控制柄决定形状的三次贝塞尔。
    Bezier,
}

/// 贝塞尔控制柄。
///
/// 用相对量而不是绝对角度：`dx` 是该段角度跨度的比例，`dy` 是该段值域的
/// 比例。这样移动关键帧、缩放数值范围时曲线形状不变。`dy` 允许超出
/// 0..1 以做出过冲。
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Handle {
    pub dx: f64,
    pub dy: f64,
}

impl Default for Handle {
    fn default() -> Self {
        // 三分之一是贝塞尔控制柄的常规默认，此时曲线接近直线。
        Self { dx: 1.0 / 3.0, dy: 0.0 }
    }
}

/// 曲线上的一个采样点：角度、取值，以及离开该点的过渡方式。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurvePoint {
    pub angle: f64,
    pub value: f64,
    pub interpolation: Interpolation,
    pub handle_out: Handle,
    pub handle_in: Handle,
}

/// 把任意角度折算到 [0, 360)。
pub fn normalize_angle(angle: f64) -> f64 {
    if !angle.is_finite() {
        return 0.0;
    }
    let wrapped = angle % CYCLE_DEGREES;
    if wrapped < 0.0 {
        wrapped + CYCLE_DEGREES
    } else {
        wrapped
    }
}

/// 在给定角度上采样一条曲线。
///
/// 采样点须已按角度升序排列。空曲线返回 None —— 该属性在这条效果里没有
/// 任何一帧记录过，调用方应当跳过它而不是当作零。
pub fn sample_points(points: &[CurvePoint], angle: f64) -> Option<f64> {
    match points.len() {
        0 => None,
        1 => Some(points[0].value),
        _ => {
            let angle = normalize_angle(angle);
            let (from, to, progress) = segment_at(points, angle);
            Some(interpolate(from, to, progress))
        }
    }
}

/// 找出角度所在的段。
///
/// 落在最后一个点之后或第一个点之前时，走的是跨越 0 度的收尾段 ——
/// 一个周期是一整圈，曲线在这里闭合成环。
fn segment_at(points: &[CurvePoint], angle: f64) -> (&CurvePoint, &CurvePoint, f64) {
    let first = &points[0];
    let last = &points[points.len() - 1];

    if angle < first.angle || angle >= last.angle {
        let span = CYCLE_DEGREES - last.angle + first.angle;
        let travelled = if angle >= last.angle {
            angle - last.angle
        } else {
            CYCLE_DEGREES - last.angle + angle
        };
        return (last, first, ratio(travelled, span));
    }

    for window in points.windows(2) {
        let (from, to) = (&window[0], &window[1]);
        if angle >= from.angle && angle < to.angle {
            return (from, to, ratio(angle - from.angle, to.angle - from.angle));
        }
    }

    (last, last, 0.0)
}

fn ratio(travelled: f64, span: f64) -> f64 {
    if span <= 0.0 {
        0.0
    } else {
        (travelled / span).clamp(0.0, 1.0)
    }
}

fn interpolate(from: &CurvePoint, to: &CurvePoint, progress: f64) -> f64 {
    match from.interpolation {
        Interpolation::Step => from.value,
        Interpolation::Linear => lerp(from.value, to.value, progress),
        Interpolation::Smooth => lerp(from.value, to.value, smoothstep(progress)),
        Interpolation::Bezier => {
            let eased = bezier_ease(from.handle_out, to.handle_in, progress);
            lerp(from.value, to.value, eased)
        }
    }
}

fn lerp(from: f64, to: f64, ratio: f64) -> f64 {
    from + (to - from) * ratio
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// 由两个控制柄决定的三次贝塞尔缓动，与 CSS 的 cubic-bezier 同构。
fn bezier_ease(out_handle: Handle, in_handle: Handle, x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    let x1 = out_handle.dx.clamp(0.0, 1.0);
    let y1 = out_handle.dy;
    let x2 = (1.0 - in_handle.dx).clamp(0.0, 1.0);
    let y2 = 1.0 - in_handle.dy;

    let t = solve_bezier_t(x, x1, x2);
    cubic_bezier(t, y1, y2)
}

/// 由 x 反解参数 t：先用牛顿法快速逼近，导数退化时退回二分。
fn solve_bezier_t(x: f64, x1: f64, x2: f64) -> f64 {
    const NEWTON_ITERATIONS: usize = 8;
    const EPSILON: f64 = 1e-6;

    let mut t = x;
    for _ in 0..NEWTON_ITERATIONS {
        let error = cubic_bezier(t, x1, x2) - x;
        if error.abs() < EPSILON {
            return t;
        }
        let derivative = cubic_bezier_derivative(t, x1, x2);
        if derivative.abs() < EPSILON {
            break;
        }
        t -= error / derivative;
    }

    let (mut low, mut high) = (0.0_f64, 1.0_f64);
    let mut t = x.clamp(0.0, 1.0);
    for _ in 0..32 {
        let value = cubic_bezier(t, x1, x2);
        if (value - x).abs() < EPSILON {
            break;
        }
        if value < x {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) / 2.0;
    }
    t
}

fn cubic_bezier(t: f64, p1: f64, p2: f64) -> f64 {
    let inv = 1.0 - t;
    3.0 * inv * inv * t * p1 + 3.0 * inv * t * t * p2 + t * t * t
}

fn cubic_bezier_derivative(t: f64, p1: f64, p2: f64) -> f64 {
    let inv = 1.0 - t;
    3.0 * inv * inv * p1 + 6.0 * inv * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(items: &[(f64, f64)]) -> Vec<CurvePoint> {
        items
            .iter()
            .map(|(angle, value)| CurvePoint {
                angle: *angle,
                value: *value,
                interpolation: Interpolation::Linear,
                handle_out: Handle::default(),
                handle_in: Handle::default(),
            })
            .collect()
    }

    #[test]
    fn angles_wrap_into_a_single_cycle() {
        assert_eq!(normalize_angle(0.0), 0.0);
        assert_eq!(normalize_angle(360.0), 0.0);
        assert_eq!(normalize_angle(450.0), 90.0);
        assert_eq!(normalize_angle(-90.0), 270.0);
    }

    #[test]
    fn a_segment_interpolates_between_two_points() {
        let curve = points(&[(0.0, 0.0), (180.0, 100.0)]);
        assert_eq!(sample_points(&curve, 0.0), Some(0.0));
        assert!((sample_points(&curve, 90.0).unwrap() - 50.0).abs() < 1e-9);
        assert!((sample_points(&curve, 180.0).unwrap() - 100.0).abs() < 1e-9);
    }

    #[test]
    fn the_curve_closes_back_to_the_first_point() {
        // 打了红和蓝两帧，后半圈应当从蓝走回红。
        let curve = points(&[(0.0, 0.0), (180.0, 100.0)]);
        assert!((sample_points(&curve, 270.0).unwrap() - 50.0).abs() < 1e-9);
        assert!(sample_points(&curve, 359.9).unwrap() < 1.0);
    }

    #[test]
    fn a_single_point_holds_a_constant() {
        let curve = points(&[(90.0, 42.0)]);
        assert_eq!(sample_points(&curve, 0.0), Some(42.0));
        assert_eq!(sample_points(&curve, 300.0), Some(42.0));
    }

    #[test]
    fn an_empty_curve_has_no_value_rather_than_zero() {
        // 没有任何一帧记录过这个属性，调用方应当跳过它 ——
        // 当成零会让灯突然熄掉。
        assert_eq!(sample_points(&[], 123.0), None);
    }

    #[test]
    fn step_holds_the_previous_value() {
        let mut curve = points(&[(0.0, 0.0), (180.0, 100.0)]);
        curve[0].interpolation = Interpolation::Step;
        assert_eq!(sample_points(&curve, 90.0), Some(0.0));
        assert_eq!(sample_points(&curve, 180.0), Some(100.0));
    }

    #[test]
    fn smooth_eases_at_both_ends_but_matches_linear_at_the_midpoint() {
        let mut curve = points(&[(0.0, 0.0), (180.0, 100.0)]);
        curve[0].interpolation = Interpolation::Smooth;
        assert!((sample_points(&curve, 90.0).unwrap() - 50.0).abs() < 1e-9);
        assert!(sample_points(&curve, 45.0).unwrap() < 25.0);
        assert!(sample_points(&curve, 135.0).unwrap() > 75.0);
    }

    #[test]
    fn bezier_handles_bend_the_curve() {
        let mut curve = points(&[(0.0, 0.0), (180.0, 100.0)]);
        curve[0].interpolation = Interpolation::Bezier;
        curve[0].handle_out = Handle { dx: 0.9, dy: 0.0 };
        curve[1].handle_in = Handle { dx: 0.1, dy: 0.0 };
        assert!(sample_points(&curve, 90.0).unwrap() < 40.0);
    }
}
