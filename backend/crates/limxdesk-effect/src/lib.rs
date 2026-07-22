// ============================================================
// 文件名称：lib.rs
// 功能描述：效果实例 —— 效果模板作用在一组灯上的那一份
//
// 效果分成两层：
//   模板   存在效果池里，只有形状、速度、相位规则，不含灯具。因此可复用。
//   实例   知道作用于哪些灯，带本次的参数覆盖。
//
// 实例是 programmer 的一层：选灯、加效果、调参数，跟调一个 Dimmer 值属于
// 同一类操作；Store 时它随 programmer 一起进 cue。这个 crate 只定义实例
// 本身，不涉及任何一种效果的求值方式 —— 关键帧只是其中一种。
//
// 放在这里而不是 programmer 或 cue 内部，是因为两边都要用它，而那两个
// crate 互不依赖，也不该为此产生依赖。
// ============================================================

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 实例上的参数覆盖。
///
/// 都是相对模板的倍率或偏移，而不是绝对值：这样改模板时所有实例跟着变，
/// 而各实例自己的调整仍然成立。
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectOverrides {
    /// 速度倍率。1 = 用模板的周期，2 = 快一倍。
    pub rate: f64,
    /// 整体相位偏移（度）。让两个用同一模板的实例错开。
    pub phase_offset: f64,
    /// 相位铺开的缩放。1 = 用模板的 spread。
    pub spread_scale: f64,
    /// 幅度缩放。1 = 用模板的曲线值，0.5 = 起伏减半。
    pub size: f64,
}

impl Default for EffectOverrides {
    fn default() -> Self {
        Self {
            rate: 1.0,
            phase_offset: 0.0,
            spread_scale: 1.0,
            size: 1.0,
        }
    }
}

impl EffectOverrides {
    /// 夹到可用范围。速度不允许为零或负 —— 那不是"停住"，是没有意义。
    pub fn normalized(self) -> Self {
        Self {
            rate: clamp_finite(self.rate, 0.01, 100.0, 1.0),
            phase_offset: clamp_finite(self.phase_offset, -3600.0, 3600.0, 0.0),
            spread_scale: clamp_finite(self.spread_scale, -10.0, 10.0, 1.0),
            size: clamp_finite(self.size, 0.0, 10.0, 1.0),
        }
    }
}

/// 一个效果实例。
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppliedEffect {
    pub id: String,
    /// 交给哪种引擎求值，对应 RecipeEngine::kind()。
    pub engine_kind: String,
    /// 效果池里的模板 id。
    pub effect_id: String,
    /// 作用的灯具。顺序即相位铺开的次序，因此不能排序去重后随意打乱。
    pub fixture_ids: Vec<String>,
    pub overrides: EffectOverrides,
    pub enabled: bool,
}

impl AppliedEffect {
    pub fn new(
        engine_kind: impl Into<String>,
        effect_id: impl Into<String>,
        fixture_ids: Vec<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            engine_kind: engine_kind.into(),
            effect_id: effect_id.into(),
            fixture_ids,
            overrides: EffectOverrides::default(),
            enabled: true,
        }
    }

    pub fn has_output(&self) -> bool {
        self.enabled && !self.fixture_ids.is_empty() && !self.effect_id.trim().is_empty()
    }

    /// 只保留给定灯具上的部分。Store 时按选择过滤要用到。
    pub fn retain_fixtures(mut self, keep: &[String]) -> Option<Self> {
        self.fixture_ids.retain(|id| keep.contains(id));
        if self.fixture_ids.is_empty() {
            None
        } else {
            Some(self)
        }
    }
}

/// 规整一组实例：丢掉空的，夹住参数。
pub fn normalize_effects(effects: Vec<AppliedEffect>) -> Vec<AppliedEffect> {
    effects
        .into_iter()
        .filter(|effect| !effect.effect_id.trim().is_empty())
        .map(|mut effect| {
            if effect.id.trim().is_empty() {
                effect.id = Uuid::new_v4().to_string();
            }
            effect.overrides = effect.overrides.normalized();
            effect.fixture_ids.retain(|id| !id.trim().is_empty());
            effect
        })
        .collect()
}

fn clamp_finite(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn applied(fixtures: &[&str]) -> AppliedEffect {
        AppliedEffect::new(
            "keyframe",
            "effect-1",
            fixtures.iter().map(|id| id.to_string()).collect(),
        )
    }

    #[test]
    fn defaults_are_neutral() {
        let overrides = EffectOverrides::default();
        assert_eq!(overrides.rate, 1.0);
        assert_eq!(overrides.phase_offset, 0.0);
        assert_eq!(overrides.spread_scale, 1.0);
        assert_eq!(overrides.size, 1.0);
    }

    #[test]
    fn a_zero_rate_falls_back_rather_than_freezing_time() {
        let overrides = EffectOverrides {
            rate: 0.0,
            ..EffectOverrides::default()
        }
        .normalized();
        assert!(overrides.rate > 0.0);
    }

    #[test]
    fn non_finite_overrides_fall_back_to_neutral() {
        let overrides = EffectOverrides {
            rate: f64::NAN,
            phase_offset: f64::INFINITY,
            spread_scale: f64::NAN,
            size: f64::NEG_INFINITY,
        }
        .normalized();
        assert_eq!(overrides.rate, 1.0);
        assert_eq!(overrides.phase_offset, 0.0);
        assert_eq!(overrides.spread_scale, 1.0);
        assert_eq!(overrides.size, 1.0);
    }

    #[test]
    fn an_instance_without_fixtures_produces_nothing() {
        assert!(!applied(&[]).has_output());
        assert!(applied(&["fix-1"]).has_output());
    }

    #[test]
    fn a_disabled_instance_produces_nothing() {
        let mut effect = applied(&["fix-1"]);
        effect.enabled = false;
        assert!(!effect.has_output());
    }

    #[test]
    fn retaining_keeps_only_the_listed_fixtures() {
        let effect = applied(&["fix-1", "fix-2", "fix-3"])
            .retain_fixtures(&["fix-2".to_string(), "fix-9".to_string()])
            .expect("still has fixtures");
        assert_eq!(effect.fixture_ids, vec!["fix-2".to_string()]);
    }

    #[test]
    fn retaining_nothing_drops_the_instance() {
        assert!(applied(&["fix-1"])
            .retain_fixtures(&["fix-9".to_string()])
            .is_none());
    }

    #[test]
    fn fixture_order_survives_normalisation() {
        // 顺序就是相位次序，规整不能打乱它。
        let effect = applied(&["fix-3", "fix-1", "fix-2"]);
        let normalized = normalize_effects(vec![effect]);
        assert_eq!(
            normalized[0].fixture_ids,
            vec!["fix-3".to_string(), "fix-1".to_string(), "fix-2".to_string()]
        );
    }

    #[test]
    fn instances_without_a_template_are_dropped() {
        let mut effect = applied(&["fix-1"]);
        effect.effect_id = "  ".to_string();
        assert!(normalize_effects(vec![effect]).is_empty());
    }
}
