// ============================================================
// 文件名称：playback.rs
// 功能描述：把流逝的时间映射到周期中的角度
//
// 效果的速度由"跑完一圈要多久"来表达，而不是由某个抽象的速率数字 ——
// 用户想要的是"四拍一圈"，不是"0.25 单位"。周期时长因此就是速度控制。
// ============================================================

use crate::curve::CYCLE_DEGREES;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind", content = "count")]
pub enum PlaybackMode {
    /// 一圈接一圈，到头直接回到起点。
    #[default]
    Loop,
    /// 正播到头再倒着播回来。用它做往复时不会在接缝处跳变。
    PingPong,
    /// 反向循环。
    Reverse,
    /// 只跑一圈，停在终点。
    Once,
    /// 跑指定圈数后停在终点。
    Repeat(u32),
}

/// 某一时刻在周期中的位置。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CyclePosition {
    /// 周期内的角度，0..360。
    pub angle: f64,
    /// 是否已经跑完（只对 Once / Repeat 有意义）。
    ///
    /// 跑完后角度停在终点，值保持不变；调用方据此让时钟停下。
    pub finished: bool,
}

impl PlaybackMode {
    /// 求某一时刻的周期位置。
    ///
    /// `elapsed_ms` 是效果启动以来的时间，`cycle_ms` 是一圈的时长。
    pub fn position(self, elapsed_ms: f64, cycle_ms: f64) -> CyclePosition {
        if !elapsed_ms.is_finite() || elapsed_ms <= 0.0 {
            return self.at_start();
        }
        if !cycle_ms.is_finite() || cycle_ms <= 0.0 {
            // 周期为零没有意义，停在起点而不是除以零。
            return self.at_start();
        }

        let cycles = elapsed_ms / cycle_ms;
        match self {
            Self::Loop => CyclePosition {
                angle: fract(cycles) * CYCLE_DEGREES,
                finished: false,
            },
            Self::Reverse => CyclePosition {
                angle: (1.0 - fract(cycles)) % 1.0 * CYCLE_DEGREES,
                finished: false,
            },
            Self::PingPong => CyclePosition {
                angle: ping_pong(cycles) * CYCLE_DEGREES,
                finished: false,
            },
            Self::Once => {
                if cycles >= 1.0 {
                    CyclePosition {
                        // 停在整圈的终点，也就是起点的值 —— 曲线是闭环的。
                        angle: 0.0,
                        finished: true,
                    }
                } else {
                    CyclePosition {
                        angle: cycles * CYCLE_DEGREES,
                        finished: false,
                    }
                }
            }
            Self::Repeat(count) => {
                let count = f64::from(count.max(1));
                if cycles >= count {
                    CyclePosition {
                        angle: 0.0,
                        finished: true,
                    }
                } else {
                    CyclePosition {
                        angle: fract(cycles) * CYCLE_DEGREES,
                        finished: false,
                    }
                }
            }
        }
    }

    fn at_start(self) -> CyclePosition {
        CyclePosition {
            angle: match self {
                // 反向从终点起步，这样第一帧就往回走。
                Self::Reverse => 0.0,
                _ => 0.0,
            },
            finished: false,
        }
    }

    /// 该模式是否会一直动下去。持续运动的效果要让时钟保持清醒。
    pub fn is_endless(self) -> bool {
        matches!(self, Self::Loop | Self::Reverse | Self::PingPong)
    }
}

fn fract(value: f64) -> f64 {
    let fractional = value.fract();
    if fractional < 0.0 {
        fractional + 1.0
    } else {
        fractional
    }
}

/// 三角波：0→1→0，周期为两圈。
fn ping_pong(cycles: f64) -> f64 {
    let doubled = fract(cycles / 2.0) * 2.0;
    if doubled <= 1.0 {
        doubled
    } else {
        2.0 - doubled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loop_wraps_every_cycle() {
        let mode = PlaybackMode::Loop;
        assert_eq!(mode.position(0.0, 1000.0).angle, 0.0);
        assert!((mode.position(250.0, 1000.0).angle - 90.0).abs() < 1e-9);
        assert!((mode.position(500.0, 1000.0).angle - 180.0).abs() < 1e-9);
        // 第二圈与第一圈同位置。
        assert!((mode.position(1250.0, 1000.0).angle - 90.0).abs() < 1e-9);
        assert!(!mode.position(5000.0, 1000.0).finished);
    }

    #[test]
    fn reverse_runs_the_cycle_backwards() {
        let mode = PlaybackMode::Reverse;
        assert!((mode.position(250.0, 1000.0).angle - 270.0).abs() < 1e-9);
        assert!((mode.position(750.0, 1000.0).angle - 90.0).abs() < 1e-9);
    }

    #[test]
    fn ping_pong_turns_around_at_the_end() {
        let mode = PlaybackMode::PingPong;
        // 前半程正向。
        assert!((mode.position(500.0, 1000.0).angle - 180.0).abs() < 1e-9);
        assert!((mode.position(1000.0, 1000.0).angle - 360.0).abs() < 1e-9);
        // 后半程折返。
        assert!((mode.position(1500.0, 1000.0).angle - 180.0).abs() < 1e-9);
        assert!(mode.position(2000.0, 1000.0).angle.abs() < 1e-9);
    }

    #[test]
    fn ping_pong_never_jumps() {
        // 折返点两侧应当连续 —— 这正是 ping-pong 相对 loop 的意义。
        let mode = PlaybackMode::PingPong;
        let before = mode.position(999.0, 1000.0).angle;
        let after = mode.position(1001.0, 1000.0).angle;
        assert!((before - after).abs() < 1.0, "{before} → {after} 出现跳变");
    }

    #[test]
    fn once_stops_after_a_single_cycle() {
        let mode = PlaybackMode::Once;
        assert!(!mode.position(500.0, 1000.0).finished);
        assert!((mode.position(500.0, 1000.0).angle - 180.0).abs() < 1e-9);
        assert!(mode.position(1000.0, 1000.0).finished);
        assert!(mode.position(9999.0, 1000.0).finished);
    }

    #[test]
    fn repeat_stops_after_the_requested_count() {
        let mode = PlaybackMode::Repeat(3);
        assert!(!mode.position(2500.0, 1000.0).finished);
        assert!(mode.position(3000.0, 1000.0).finished);
    }

    #[test]
    fn repeat_of_zero_still_runs_one_cycle() {
        // 0 圈的效果没有意义，当作 1 圈处理而不是永远不出光。
        let mode = PlaybackMode::Repeat(0);
        assert!(!mode.position(500.0, 1000.0).finished);
        assert!(mode.position(1000.0, 1000.0).finished);
    }

    #[test]
    fn a_zero_cycle_time_parks_at_the_start_instead_of_dividing_by_zero() {
        let position = PlaybackMode::Loop.position(500.0, 0.0);
        assert_eq!(position.angle, 0.0);
        assert!(!position.finished);
    }

    #[test]
    fn endlessness_is_reported_per_mode() {
        assert!(PlaybackMode::Loop.is_endless());
        assert!(PlaybackMode::Reverse.is_endless());
        assert!(PlaybackMode::PingPong.is_endless());
        assert!(!PlaybackMode::Once.is_endless());
        assert!(!PlaybackMode::Repeat(2).is_endless());
    }
}
