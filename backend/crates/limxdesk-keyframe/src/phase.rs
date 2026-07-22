// ============================================================
// 文件名称：phase.rs
// 功能描述：把效果在一组灯之间错开
//
// 所有灯同时做同一件事只是闪烁；效果之所以成为效果，在于灯与灯之间
// 错开的那点相位。这里描述"怎么错开"：
//
//   spread  整组从头到尾铺开多少度。360 表示首尾恰好差一整圈
//   blocks  每几盏灯算一个整体，块内不再错开
//   groups  整条效果在选择上重复几遍
//   wings   分成几段，偶数段镜像，做出对称的开合
//   reverse 反向铺开
//
// 顺序固定为 wings → blocks → groups，先分段、再成块、最后决定重复几遍。
// ============================================================

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhaseSpread {
    pub spread: f64,
    pub blocks: u32,
    pub groups: u32,
    pub wings: u32,
    pub reverse: bool,
}

impl Default for PhaseSpread {
    fn default() -> Self {
        // 默认整组铺开一整圈：最直观的"跑马灯"起点。
        Self {
            spread: 360.0,
            blocks: 1,
            groups: 1,
            wings: 1,
            reverse: false,
        }
    }
}

impl PhaseSpread {
    /// 求第 `index` 盏灯（共 `total` 盏）的相位偏移，单位为度。
    pub fn offset(&self, index: usize, total: usize) -> f64 {
        if total == 0 || index >= total {
            return 0.0;
        }
        let spread = if self.spread.is_finite() { self.spread } else { 0.0 };
        if spread == 0.0 {
            return 0.0;
        }

        let (index, count) = self.apply_wings(index, total);
        let (index, count) = apply_blocks(index, count, self.blocks);
        let position = self.position_within(index, count);

        let offset = position * spread;
        if self.reverse {
            -offset
        } else {
            offset
        }
    }

    /// 把序号折进所属的翼，奇数翼镜像。
    ///
    /// 镜像是这个参数的全部意义：左右两侧对称地开合，而不是一路平移过去。
    fn apply_wings(&self, index: usize, total: usize) -> (usize, usize) {
        let wings = self.wings.max(1) as usize;
        if wings <= 1 {
            return (index, total);
        }

        let wing_size = total.div_ceil(wings);
        if wing_size == 0 {
            return (index, total);
        }

        let wing = index / wing_size;
        let mut position = index % wing_size;
        // 该翼可能不满（总数除不尽时的最后一翼）。
        let actual_size = wing_size.min(total - wing * wing_size);
        if wing % 2 == 1 {
            position = actual_size.saturating_sub(1) - position.min(actual_size.saturating_sub(1));
        }
        (position, wing_size)
    }

    /// 序号在 0..1 之间的归一化位置。
    ///
    /// groups 大于 1 时把序列切成若干段，每段各自从头铺到尾 ——
    /// 也就是整条效果在选择上重复若干遍。
    fn position_within(&self, index: usize, count: usize) -> f64 {
        if count <= 1 {
            return 0.0;
        }
        let groups = self.groups.max(1) as usize;
        if groups <= 1 {
            return index as f64 / count as f64;
        }

        let segment = count.div_ceil(groups);
        if segment <= 1 {
            return 0.0;
        }
        (index % segment) as f64 / segment as f64
    }
}

/// 把相邻的灯并成块，块内相位一致。
fn apply_blocks(index: usize, total: usize, blocks: u32) -> (usize, usize) {
    let blocks = blocks.max(1) as usize;
    if blocks <= 1 {
        return (index, total);
    }
    (index / blocks, total.div_ceil(blocks))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offsets(spread: PhaseSpread, total: usize) -> Vec<f64> {
        (0..total)
            .map(|index| (spread.offset(index, total) * 1000.0).round() / 1000.0)
            .collect()
    }

    #[test]
    fn default_spreads_one_full_turn_across_the_selection() {
        let result = offsets(PhaseSpread::default(), 4);
        assert_eq!(result, vec![0.0, 90.0, 180.0, 270.0]);
    }

    #[test]
    fn zero_spread_keeps_every_fixture_in_step() {
        let spread = PhaseSpread {
            spread: 0.0,
            ..PhaseSpread::default()
        };
        assert_eq!(offsets(spread, 4), vec![0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn half_spread_fans_across_half_a_turn() {
        let spread = PhaseSpread {
            spread: 180.0,
            ..PhaseSpread::default()
        };
        assert_eq!(offsets(spread, 4), vec![0.0, 45.0, 90.0, 135.0]);
    }

    #[test]
    fn reverse_flips_the_direction() {
        let spread = PhaseSpread {
            reverse: true,
            ..PhaseSpread::default()
        };
        assert_eq!(offsets(spread, 4), vec![0.0, -90.0, -180.0, -270.0]);
    }

    #[test]
    fn blocks_move_neighbours_together() {
        let spread = PhaseSpread {
            blocks: 2,
            ..PhaseSpread::default()
        };
        // 每两盏一块，块内同相，块间铺开。
        assert_eq!(offsets(spread, 4), vec![0.0, 0.0, 180.0, 180.0]);
    }

    #[test]
    fn groups_repeat_the_effect_across_the_selection() {
        let spread = PhaseSpread {
            groups: 2,
            ..PhaseSpread::default()
        };
        // 四盏灯跑两遍，每遍两盏。
        assert_eq!(offsets(spread, 4), vec![0.0, 180.0, 0.0, 180.0]);
    }

    #[test]
    fn wings_mirror_the_second_half() {
        let spread = PhaseSpread {
            wings: 2,
            ..PhaseSpread::default()
        };
        // 后一翼反着排，两侧对称开合。
        assert_eq!(offsets(spread, 4), vec![0.0, 180.0, 180.0, 0.0]);
    }

    #[test]
    fn a_single_fixture_has_no_offset() {
        assert_eq!(offsets(PhaseSpread::default(), 1), vec![0.0]);
    }

    #[test]
    fn out_of_range_index_is_zero_rather_than_panicking() {
        assert_eq!(PhaseSpread::default().offset(9, 4), 0.0);
        assert_eq!(PhaseSpread::default().offset(0, 0), 0.0);
    }

    #[test]
    fn odd_totals_do_not_panic_on_wings_or_blocks() {
        let spread = PhaseSpread {
            wings: 2,
            blocks: 2,
            groups: 2,
            ..PhaseSpread::default()
        };
        // 只要不 panic、结果有限即可 —— 这里验证的是边界安全。
        for total in 1..=9 {
            for value in offsets(spread, total) {
                assert!(value.is_finite());
            }
        }
    }
}
