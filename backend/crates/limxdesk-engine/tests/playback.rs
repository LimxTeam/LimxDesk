//! 回放引擎的行为测试。
//!
//! 覆盖的是过去只存在于字段里、没有实际行为的那些语义：淡变、回绕、
//! 暂停、flash、多步推进、释放淡出，以及同一 sequence 在多个 executor
//! 上各自独立播放。

use limxdesk_cue::{Cue, CuePart, CueStep, CueTiming, CueValue, CueValueLayer, CueValueSource};
use limxdesk_dmx::DmxOutputValue;
use limxdesk_engine::{ExecutorKey, Motion, PlayState, PlaybackEngine};
use limxdesk_playback::{
    assign_executor, normalize_document as normalize_playback, ExecutorAssignment,
    ExecutorAssignmentKind, PlaybackAction, PlaybackDocument,
};
use limxdesk_sequence::{Sequence, SequenceDocument};

const PAGE: &str = "page-1";

// ── 构造辅助 ────────────────────────────────────────────────

fn value(fixture: &str, attribute: &str, group: &str, numeric: f64) -> CueValue {
    CueValue {
        fixture_id: fixture.to_string(),
        attribute: attribute.to_string(),
        feature_group: group.to_string(),
        layer: CueValueLayer::Absolute,
        numeric: Some(numeric),
        text: None,
        active: true,
        source: CueValueSource::Programmer,
    }
}

fn layered(fixture: &str, attribute: &str, group: &str, numeric: f64, layer: CueValueLayer) -> CueValue {
    CueValue {
        layer,
        ..value(fixture, attribute, group, numeric)
    }
}

fn dimmer(fixture: &str, numeric: f64) -> CueValue {
    value(fixture, "Dimmer", "Dimmer", numeric)
}

fn cue(number: f64, values: Vec<CueValue>, timing: CueTiming) -> Cue {
    let mut cue = Cue::new(number, "", values, 0).expect("cue builds");
    cue.timing = timing;
    cue
}

fn timing(fade_in: f64, delay_in: f64, fade_out: f64) -> CueTiming {
    CueTiming {
        fade_in,
        fade_out,
        delay_in,
        delay_out: 0.0,
        duration: None,
    }
}

fn sequence_with(cues: Vec<Cue>) -> (SequenceDocument, String) {
    let mut sequence = Sequence::new(1, "Main", 0).expect("sequence builds");
    sequence.cues = cues;
    let id = sequence.id.clone();
    (
        SequenceDocument {
            sequences: vec![sequence],
            selected_sequence_id: Some(id.clone()),
            version: 1,
        },
        id,
    )
}

/// 建一个已把 sequence 指派到首个 executor 的引擎。
fn engine_with(document: &SequenceDocument, sequence_id: &str) -> (PlaybackEngine, ExecutorKey) {
    let playback = playback_with(&[(0, sequence_id)]);
    let mut engine = PlaybackEngine::new();
    engine.reload_document(document);
    engine.sync_assignments(&playback);
    let key = executor_key(&playback, 0);
    (engine, key)
}

fn playback_with(assignments: &[(usize, &str)]) -> PlaybackDocument {
    let mut playback = normalize_playback(PlaybackDocument::default());
    for (index, sequence_id) in assignments {
        let executor_id = playback.pages[0].executors[*index].id.clone();
        playback = assign_executor(
            playback,
            PAGE,
            &executor_id,
            ExecutorAssignment {
                kind: ExecutorAssignmentKind::Sequence,
                object_id: sequence_id.to_string(),
                object_name: "Main".to_string(),
            },
        )
        .expect("assignment applies");
    }
    playback
}

fn executor_key(playback: &PlaybackDocument, index: usize) -> ExecutorKey {
    ExecutorKey::new(PAGE, playback.pages[0].executors[index].id.clone())
}

fn find(values: &[DmxOutputValue], fixture: &str, attribute: &str) -> Option<f64> {
    values
        .iter()
        .find(|value| value.fixture_id == fixture && value.attribute == attribute)
        .and_then(|value| value.numeric)
}

/// 推进引擎若干毫秒，按 25ms 一帧切分，模拟真实 tick 节奏。
fn advance(engine: &mut PlaybackEngine, from_ms: u64, duration_ms: u64) -> u64 {
    let mut now = from_ms;
    let end = from_ms + duration_ms;
    while now < end {
        now = (now + 25).min(end);
        engine.tick(now);
    }
    now
}

// ── 淡变 ────────────────────────────────────────────────────

#[test]
fn cue_fade_in_interpolates_over_time() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        timing(2.0, 0.0, 0.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    // 起点：还没走时间，强度从零起。
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(0.0));

    let now = advance(&mut engine, 0, 1000);
    let mid = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!(
        (mid - 50.0).abs() < 5.0,
        "两秒淡入走到一半应约为 50，实际 {mid}"
    );

    advance(&mut engine, now, 1500);
    let end = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!((end - 100.0).abs() < 0.001, "淡入结束应到 100，实际 {end}");
}

#[test]
fn cue_delay_holds_the_value_before_fading() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        timing(1.0, 1.0, 0.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    let now = advance(&mut engine, 0, 800);
    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(0.0),
        "延迟期间不应开始淡入"
    );

    advance(&mut engine, now, 1400);
    let value = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!(value > 90.0, "延迟结束后应淡到接近目标，实际 {value}");
}

#[test]
fn per_attribute_fade_layer_overrides_cue_timing() {
    // Dimmer 用 cue 的 4 秒，Pan 用自己的 1 秒。
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![
            dimmer("fix-1", 100.0),
            value("fix-1", "Pan", "Position", 100.0),
            layered("fix-1", "Pan", "Position", 1.0, CueValueLayer::Fade),
        ],
        timing(4.0, 0.0, 0.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);
    advance(&mut engine, 0, 1100);

    let output = engine.collect_output();
    let pan = find(&output, "fix-1", "Pan").unwrap();
    let dim = find(&output, "fix-1", "Dimmer").unwrap();

    assert!((pan - 100.0).abs() < 0.001, "Pan 的 1 秒淡入应已完成，实际 {pan}");
    assert!(dim < 40.0, "Dimmer 仍走 cue 的 4 秒，实际 {dim}");
}

#[test]
fn rate_scales_fade_speed() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        timing(2.0, 0.0, 0.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.set_rate(&key, 2.0);
    engine.fire(&key, PlaybackAction::Go);

    // 双倍速下 1 秒就应走完 2 秒的淡入。
    advance(&mut engine, 0, 1100);
    let value = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!((value - 100.0).abs() < 0.001, "双倍速应已淡完，实际 {value}");
}

// ── cue 推进 ────────────────────────────────────────────────

#[test]
fn go_wraps_around_at_the_last_cue() {
    let (document, sequence_id) = sequence_with(vec![
        cue(1.0, vec![dimmer("fix-1", 10.0)], CueTiming::default()),
        cue(2.0, vec![dimmer("fix-1", 20.0)], CueTiming::default()),
    ]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::Go);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(10.0));

    engine.fire(&key, PlaybackAction::Go);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(20.0));

    // 旧实现在这里会卡住不动。
    engine.fire(&key, PlaybackAction::Go);
    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(10.0),
        "走到末尾应回绕到第一个 cue"
    );
}

#[test]
fn back_wraps_to_the_last_cue() {
    let (document, sequence_id) = sequence_with(vec![
        cue(1.0, vec![dimmer("fix-1", 10.0)], CueTiming::default()),
        cue(2.0, vec![dimmer("fix-1", 20.0)], CueTiming::default()),
    ]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::Go);
    engine.fire(&key, PlaybackAction::Back);

    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(20.0));
}

#[test]
fn tracking_carries_values_forward_between_cues() {
    let (document, sequence_id) = sequence_with(vec![
        cue(
            1.0,
            vec![dimmer("fix-1", 80.0), value("fix-1", "Pan", "Position", 45.0)],
            CueTiming::default(),
        ),
        // 第二个 cue 只动 Dimmer，Pan 应当被 tracking 带下来。
        cue(2.0, vec![dimmer("fix-1", 20.0)], CueTiming::default()),
    ]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::Go);
    engine.fire(&key, PlaybackAction::Go);

    let output = engine.collect_output();
    assert_eq!(find(&output, "fix-1", "Dimmer"), Some(20.0));
    assert_eq!(
        find(&output, "fix-1", "Pan"),
        Some(45.0),
        "Pan 应从上一个 cue tracking 下来"
    );
}

#[test]
fn relative_layer_adds_onto_the_absolute_base() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![
            dimmer("fix-1", 50.0),
            layered("fix-1", "Dimmer", "Dimmer", 20.0, CueValueLayer::Relative),
        ],
        CueTiming::default(),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(70.0),
        "Relative 层应叠加到 Absolute 基值上，而不是被丢弃"
    );
}

// ── 回放动作 ────────────────────────────────────────────────

#[test]
fn pause_freezes_the_fade_and_resume_continues_it() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        timing(4.0, 0.0, 0.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);
    let now = advance(&mut engine, 0, 1000);

    engine.fire(&key, PlaybackAction::Pause);
    let paused_value = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();

    let now = advance(&mut engine, now, 2000);
    let still = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!(
        (still - paused_value).abs() < 0.001,
        "暂停期间输出不应变化：{paused_value} → {still}"
    );

    engine.fire(&key, PlaybackAction::Pause);
    advance(&mut engine, now, 1000);
    let resumed = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!(resumed > still + 5.0, "恢复后应继续淡入，实际 {resumed}");
}

#[test]
fn toggle_switches_between_running_and_off() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        CueTiming::default(),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::Toggle);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(100.0));

    // 旧实现把 Toggle 当 Go，这里会停在 100 不灭。
    engine.fire(&key, PlaybackAction::Toggle);
    assert!(
        engine.collect_output().is_empty(),
        "再次 Toggle 应熄灭该 executor"
    );
}

#[test]
fn flash_lifts_intensity_without_moving_the_cue_pointer() {
    let (document, sequence_id) = sequence_with(vec![
        cue(1.0, vec![dimmer("fix-1", 40.0)], CueTiming::default()),
        cue(2.0, vec![dimmer("fix-1", 60.0)], CueTiming::default()),
    ]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::Go);
    engine.set_master(&key, 0.5);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(20.0));

    let before = engine.snapshot().executors[0].current_cue_id.clone();
    engine.fire(&key, PlaybackAction::FlashOn);
    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(40.0),
        "Flash 期间强度应顶到满推子"
    );
    assert_eq!(
        engine.snapshot().executors[0].current_cue_id, before,
        "Flash 不应移动 cue 指针"
    );

    engine.fire(&key, PlaybackAction::FlashOff);
    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(20.0),
        "松开 Flash 应回到推子值"
    );
}

#[test]
fn flash_on_an_idle_executor_lights_it_then_releases() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        CueTiming::default(),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);

    engine.fire(&key, PlaybackAction::FlashOn);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(100.0));

    engine.fire(&key, PlaybackAction::FlashOff);
    assert!(
        engine.collect_output().is_empty(),
        "对原本停着的 executor 松开 Flash 应回到熄灭"
    );
}

#[test]
fn off_fades_out_when_release_on_off_is_set() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        timing(0.0, 0.0, 2.0),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);

    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);
    let now = advance(&mut engine, 0, 100);
    assert_eq!(find(&engine.collect_output(), "fix-1", "Dimmer"), Some(100.0));

    engine.fire(&key, PlaybackAction::Off);
    let now = advance(&mut engine, now, 1000);
    let mid = find(&engine.collect_output(), "fix-1", "Dimmer").unwrap();
    assert!(
        mid > 10.0 && mid < 90.0,
        "Off 应走淡出而不是立刻消失，实际 {mid}"
    );

    advance(&mut engine, now, 1200);
    assert!(engine.collect_output().is_empty(), "淡出结束后应完全释放");
    assert_eq!(engine.snapshot().executors[0].state, PlayState::Idle);
}

// ── 多步 ────────────────────────────────────────────────────

#[test]
fn multi_step_part_advances_over_time_instead_of_lighting_at_once() {
    let mut base = cue(1.0, vec![dimmer("fix-1", 0.0)], CueTiming::default());
    base.parts = vec![CuePart {
        id: 0,
        name: "Chase".to_string(),
        timing: CueTiming::default(),
        values: Vec::new(),
        steps: vec![
            CueStep {
                id: 0,
                name: "A".to_string(),
                timing: step_timing(0.5),
                values: vec![dimmer("fix-1", 100.0)],
            },
            CueStep {
                id: 1,
                name: "B".to_string(),
                timing: step_timing(0.5),
                values: vec![dimmer("fix-2", 100.0)],
            },
        ],
    }];

    let (document, sequence_id) = sequence_with(vec![base]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    // 第一步：只有 fix-1 亮。旧实现会把两步一起展平输出。
    let output = engine.collect_output();
    assert_eq!(find(&output, "fix-1", "Dimmer"), Some(100.0));
    assert_eq!(find(&output, "fix-2", "Dimmer"), None);

    let now = advance(&mut engine, 0, 600);
    let output = engine.collect_output();
    assert_eq!(find(&output, "fix-2", "Dimmer"), Some(100.0));
    assert_eq!(find(&output, "fix-1", "Dimmer"), None, "应已推进到第二步");

    // 再走一个步长应回到第一步 —— 多步链是循环的。
    advance(&mut engine, now, 600);
    assert_eq!(
        find(&engine.collect_output(), "fix-1", "Dimmer"),
        Some(100.0)
    );
}

#[test]
fn a_running_chaser_keeps_the_clock_awake() {
    let mut base = cue(1.0, vec![dimmer("fix-1", 0.0)], CueTiming::default());
    base.parts = vec![CuePart {
        id: 0,
        name: "Chase".to_string(),
        timing: CueTiming::default(),
        values: Vec::new(),
        steps: vec![
            CueStep {
                id: 0,
                name: "A".to_string(),
                timing: step_timing(0.5),
                values: vec![dimmer("fix-1", 100.0)],
            },
            CueStep {
                id: 1,
                name: "B".to_string(),
                timing: step_timing(0.5),
                values: vec![dimmer("fix-2", 100.0)],
            },
        ],
    }];

    let (document, sequence_id) = sequence_with(vec![base]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    engine.tick(25);
    assert_eq!(
        engine.tick(50),
        Motion::Moving,
        "多步链在跑时时钟不能停"
    );
}

#[test]
fn a_settled_cue_lets_the_clock_park() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        CueTiming::default(),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    advance(&mut engine, 0, 200);
    assert_eq!(
        engine.tick(500),
        Motion::Settled,
        "淡变走完且没有多步时应报告静止，好让时钟停下"
    );
}

fn step_timing(duration: f64) -> CueTiming {
    CueTiming {
        duration: Some(duration),
        ..CueTiming::default()
    }
}

// ── 多 executor ─────────────────────────────────────────────

#[test]
fn one_sequence_on_two_executors_keeps_independent_playheads() {
    let (document, sequence_id) = sequence_with(vec![
        cue(1.0, vec![dimmer("fix-1", 10.0)], CueTiming::default()),
        cue(2.0, vec![dimmer("fix-1", 20.0)], CueTiming::default()),
    ]);

    let playback = playback_with(&[(0, &sequence_id), (1, &sequence_id)]);
    let mut engine = PlaybackEngine::new();
    engine.reload_document(&document);
    engine.sync_assignments(&playback);
    let first = executor_key(&playback, 0);
    let second = executor_key(&playback, 1);
    engine.tick(0);

    engine.fire(&first, PlaybackAction::Go);
    engine.fire(&second, PlaybackAction::Go);
    engine.fire(&second, PlaybackAction::Go);

    let snapshot = engine.snapshot();
    let first_cue = snapshot
        .executors
        .iter()
        .find(|state| state.executor_id == first.executor_id)
        .and_then(|state| state.current_cue_id.clone());
    let second_cue = snapshot
        .executors
        .iter()
        .find(|state| state.executor_id == second.executor_id)
        .and_then(|state| state.current_cue_id.clone());

    assert!(
        first_cue != second_cue,
        "同一 sequence 指派到两个 executor 时应各有独立播放头"
    );
}

#[test]
fn master_scales_intensity_but_leaves_position_alone() {
    let (document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![
            dimmer("fix-1", 100.0),
            value("fix-1", "Pan", "Position", 90.0),
        ],
        CueTiming::default(),
    )]);
    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);
    engine.set_master(&key, 0.5);

    let output = engine.collect_output();
    assert_eq!(find(&output, "fix-1", "Dimmer"), Some(50.0));
    assert_eq!(
        find(&output, "fix-1", "Pan"),
        Some(90.0),
        "推子不应缩放位置属性"
    );
}

#[test]
fn sequence_priority_reaches_the_output_values() {
    let (mut document, sequence_id) = sequence_with(vec![cue(
        1.0,
        vec![dimmer("fix-1", 100.0)],
        CueTiming::default(),
    )]);
    document.sequences[0].priority = 77;

    let (mut engine, key) = engine_with(&document, &sequence_id);
    engine.tick(0);
    engine.fire(&key, PlaybackAction::Go);

    let output = engine.collect_output();
    assert_eq!(
        output[0].priority, 77,
        "Sequence.priority 必须传到渲染层，否则多序列的覆盖顺序无从判定"
    );
}
