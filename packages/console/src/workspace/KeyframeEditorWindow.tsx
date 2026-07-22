import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CurveEditor } from "./keyframe/CurveEditor";
import { CYCLE_DEGREES, sortKeyframes, type Interpolation, type Keyframe } from "./keyframe/curve";
import { clearWorkspaceRuntimeCache } from "./workspaceRuntime";

/**
 * 关键帧效果编辑器。
 *
 * 这里编辑的是效果模板：形状、速度、相位规则，不含灯具。选中灯之后点
 * "应用"，效果就落到 programmer 的效果层上；随后按 Store 选一个插槽，
 * 它跟 programmer 里的其他内容一起进 cue —— 存效果走的是既有的那条
 * 保存链路，没有单独的保存命令。
 *
 * 一个周期是一整圈 360 度：打上首尾帧，曲线自动闭环。速度用"跑完一圈
 * 要多久"来设，而不是某个抽象的速率数字。
 */

// ── 契约类型（对应 limxdesk-keyframe） ──────────────────────

type PlaybackKind = "loop" | "pingPong" | "reverse" | "once" | "repeat";
type TrackLayer = "absolute" | "relative";

interface PlaybackMode {
  kind: PlaybackKind;
  count?: number;
}

interface PhaseSpread {
  spread: number;
  blocks: number;
  groups: number;
  wings: number;
  reverse: boolean;
}

interface KeyframeTrack {
  id: string;
  attribute: string;
  featureGroup: string;
  layer: TrackLayer;
  enabled: boolean;
  keyframes: Keyframe[];
}

interface KeyframeEffect {
  id: string;
  number: number;
  name: string;
  cycleMs: number;
  playback: PlaybackMode;
  phase: PhaseSpread;
  tracks: KeyframeTrack[];
  updatedAtMs: number;
}

interface KeyframeLibraryDocument {
  effects: KeyframeEffect[];
  selectedEffectId: string | null;
  version: number;
}

interface FixtureSelection {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

const PLAYBACK_LABELS: Array<{ kind: PlaybackKind; label: string; hint: string }> = [
  { kind: "loop", label: "循环", hint: "一圈接一圈" },
  { kind: "pingPong", label: "反弹", hint: "到头折返，接缝处不跳变" },
  { kind: "reverse", label: "倒放", hint: "反向循环" },
  { kind: "once", label: "单次", hint: "跑一圈后停住" },
  { kind: "repeat", label: "定次", hint: "跑指定圈数后停住" },
];

const INTERPOLATION_LABELS: Array<{ value: Interpolation; label: string }> = [
  { value: "step", label: "阶跃" },
  { value: "linear", label: "线性" },
  { value: "smooth", label: "平滑" },
  { value: "bezier", label: "贝塞尔" },
];

/** 灯库里存在的属性，用于查量程与补充建轨道。 */
interface AttributeOption {
  name: string;
  featureGroup: string;
  minValue: number | null;
  maxValue: number | null;
  defaultValue: number | null;
  valueKind: string;
  fixtureCount: number;
  totalFixtures: number;
}

/**
 * programmer 里已激活的属性 —— 你已经调过的那些。
 *
 * 效果的轨道从这里来：调过什么，效果就驱动什么。让人从灯库的全量清单里
 * 挑属性是把编程顺序倒过来了。
 */
interface ActiveAttribute {
  attribute: string;
  featureGroup: string;
  /** 当前值，作为曲线的基准 */
  value: number | null;
  fixtureCount: number;
  totalFixtures: number;
}

export function KeyframeEditorWindow() {
  const [document, setDocument] = useState<KeyframeLibraryDocument>({
    effects: [],
    selectedEffectId: null,
    version: 0,
  });
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedKeyframe, setSelectedKeyframe] = useState<number | null>(null);
  const [status, setStatus] = useState("No show loaded");
  const [previewAngle, setPreviewAngle] = useState<number | null>(null);
  const [attributes, setAttributes] = useState<AttributeOption[]>([]);
  const [activeAttributes, setActiveAttributes] = useState<ActiveAttribute[]>([]);
  const [selection, setSelection] = useState<FixtureSelection>({
    fixtureIds: [],
    primaryFixtureId: null,
    version: 0,
  });

  // 编辑是本地即时的，落盘另行节流 —— 拖一次曲线不该写十几次 show 文件。
  const pendingSaveRef = useRef<KeyframeEffect | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const effect = useMemo(
    () =>
      document.effects.find((item) => item.id === document.selectedEffectId) ??
      document.effects[0] ??
      null,
    [document.effects, document.selectedEffectId],
  );

  // 灯库里有、但编程器还没碰过的属性。放在次要位置备用。
  const otherAttributes = useMemo(
    () =>
      attributes.filter(
        (option) => !activeAttributes.some((item) => item.attribute === option.name),
      ),
    [attributes, activeAttributes],
  );

  const track = useMemo(
    () => effect?.tracks.find((item) => item.id === selectedTrackId) ?? effect?.tracks[0] ?? null,
    [effect, selectedTrackId],
  );

  useEffect(() => {
    void load();
    void invoke<FixtureSelection>("fixture_selection_get").then(setSelection).catch(() => {});
    return () => flushPendingSave();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const changed = await listen("keyframe:changed", () => {
        void load();
      });
      const selectionChanged = await listen<FixtureSelection>(
        "fixture-selection:changed",
        (event) => setSelection(event.payload),
      );
      const showLoaded = await listen("show:loaded", () => {
        void load();
      });
      const showDeleted = await listen("show:deleted", () => {
        setDocument({ effects: [], selectedEffectId: null, version: 0 });
        setStatus("No show loaded");
      });

      if (!active) {
        changed();
        selectionChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(changed, selectionChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // 预览播放头：按效果的周期与模式在本地推进，纯显示用途。
  useEffect(() => {
    if (!effect) {
      setPreviewAngle(null);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const step = () => {
      const elapsed = performance.now() - startedAt;
      setPreviewAngle(previewAngleFor(effect, elapsed));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [effect?.id, effect?.cycleMs, effect?.playback.kind, effect?.playback.count]);

  // 可用属性取决于手上选中的灯 —— 型号不同能做的事就不同，
  // 一份写死的清单在真实 rig 上必然是错的。
  useEffect(() => {
    if (selection.fixtureIds.length === 0) {
      setAttributes([]);
      return;
    }
    let active = true;
    void invoke<AttributeOption[]>("keyframe_available_attributes", {
      fixtureIds: selection.fixtureIds,
    })
      .then((next) => {
        if (active) setAttributes(next);
      })
      .catch((error) => {
        if (active) setStatus(String(error));
      });
    return () => {
      active = false;
    };
  }, [selection.fixtureIds.join("|")]);

  // programmer 里已激活的属性。它随每次调值变化，因此跟着
  // programmer:changed 走。
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void invoke<ActiveAttribute[]>("programmer_active_attributes")
        .then((next) => {
          if (active) setActiveAttributes(next);
        })
        .catch(() => {
          if (active) setActiveAttributes([]);
        });
    };
    refresh();

    let unlisten: (() => void) | null = null;
    void listen("programmer:changed", refresh).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [selection.fixtureIds.join("|")]);

  async function load() {
    try {
      const next = await invoke<KeyframeLibraryDocument>("keyframe_load_current_show");
      setDocument(next);
      setStatus(
        next.effects.length === 0
          ? "No effects yet"
          : `${next.effects.length} effect${next.effects.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      setDocument({ effects: [], selectedEffectId: null, version: 0 });
      setStatus(String(error));
    }
  }

  /**
   * 本地立即生效，落盘延后合并。
   *
   * 拖动曲线会连续产生几十次改动，每次都写 show 文件既慢也毫无必要；
   * 这里只保留最后一次，静止 220ms 后再写。
   */
  const applyEffect = useCallback((next: KeyframeEffect) => {
    setDocument((current) => ({
      ...current,
      effects: current.effects.map((item) => (item.id === next.id ? next : item)),
    }));

    pendingSaveRef.current = next;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) void persist(pending);
    }, 220);
  }, []);

  function flushPendingSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) void persist(pending);
  }

  async function persist(next: KeyframeEffect) {
    try {
      clearWorkspaceRuntimeCache(["frames"]);
      await invoke<KeyframeLibraryDocument>("keyframe_update_effect", { effect: next });
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function run(command: string, args: Record<string, unknown> = {}) {
    try {
      flushPendingSave();
      const next = await invoke<KeyframeLibraryDocument>(command, args);
      setDocument(next);
      setSelectedKeyframe(null);
    } catch (error) {
      setStatus(String(error));
    }
  }

  function updateTrack(next: KeyframeTrack) {
    if (!effect) return;
    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) => (item.id === next.id ? next : item)),
    });
  }

  function addTrack(attribute: string, featureGroup: string) {
    if (!effect) return;
    const existing = effect.tracks.find((item) => item.attribute === attribute);
    if (existing) {
      setSelectedTrackId(existing.id);
      setStatus(`${attribute} 已有轨道`);
      return;
    }
    const created: KeyframeTrack = {
      id: crypto.randomUUID(),
      attribute,
      featureGroup,
      layer: "absolute",
      enabled: true,
      keyframes: sortKeyframes(curveFor(attribute)),
    };
    applyEffect({ ...effect, tracks: [...effect.tracks, created] });
    setSelectedTrackId(created.id);
    setSelectedKeyframe(null);
  }

  /**
   * 以 programmer 现值为基准生成首尾两帧。
   *
   * 与后端 curve_from_current 同一套规则：现值当高点，量程低端当低点；
   * 量程跨零的属性（Pan/Tilt）则绕现值对称摆动。
   */
  function curveFor(attribute: string): Keyframe[] {
    const current = activeAttributes.find((item) => item.attribute === attribute)?.value ?? null;
    const range = attributes.find((item) => item.name === attribute);
    const min = range?.minValue ?? null;
    const max = range?.maxValue ?? null;
    const base = current ?? (max ?? 100);

    let low = 0;
    let high = base;
    if (min !== null && max !== null && min < 0 && max > 0) {
      const reach = Math.abs((max - min) * 0.25);
      low = Math.max(min, base - reach);
      high = Math.min(max, base + reach);
    } else if (min !== null) {
      low = min;
      high = base;
    }

    const handle = { dx: 1 / 3, dy: 0 };
    return [
      { angle: 0, value: round(low), interpolation: "smooth", handleOut: { ...handle }, handleIn: { ...handle } },
      { angle: 180, value: round(high), interpolation: "smooth", handleOut: { ...handle }, handleIn: { ...handle } },
    ];
  }

  function removeTrack(trackId: string) {
    if (!effect) return;
    applyEffect({ ...effect, tracks: effect.tracks.filter((item) => item.id !== trackId) });
    setSelectedTrackId(null);
  }

  /**
   * 把效果应用到当前选择，进入 programmer。
   *
   * 之后按 Store 选插槽即可存下 —— 效果和 programmer 里的其他内容一起走，
   * 不需要为它单开一条保存路径。
   */
  async function applyToSelection() {
    if (!effect) return;
    flushPendingSave();
    try {
      await invoke("keyframe_apply_to_selection", { effectId: effect.id });
      setStatus(`已应用到 ${selection.fixtureIds.length} 盏灯 · 按 Store 选插槽存下`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  function updateKeyframes(next: Keyframe[]) {
    if (!effect || !track) return;
    updateTrack({ ...track, keyframes: next });
  }

  function updateSelectedKeyframe(patch: Partial<Keyframe>) {
    if (!track || selectedKeyframe === null) return;
    const next = track.keyframes.map((frame, index) =>
      index === selectedKeyframe ? { ...frame, ...patch } : frame,
    );
    updateTrack({ ...track, keyframes: sortKeyframes(next) });
  }

  function deleteSelectedKeyframe() {
    if (!track || selectedKeyframe === null) return;
    if (track.keyframes.length <= 1) {
      setStatus("至少保留一帧");
      return;
    }
    updateTrack({
      ...track,
      keyframes: track.keyframes.filter((_, index) => index !== selectedKeyframe),
    });
    setSelectedKeyframe(null);
  }

  const frame = selectedKeyframe !== null ? track?.keyframes[selectedKeyframe] ?? null : null;

  return (
    <div style={rootStyle}>
      {/* 工具栏：效果的增删选 */}
      <div style={toolbarStyle}>
        <span style={badgeStyle}>FX</span>
        <select
          className="lx-input lx-input-sm"
          value={effect?.id ?? ""}
          onChange={(event) => void run("keyframe_select_effect", { effectId: event.currentTarget.value })}
          style={{ width: 190 }}
          disabled={document.effects.length === 0}
        >
          {document.effects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.number} · {item.name}
            </option>
          ))}
          {document.effects.length === 0 && <option value="">无效果</option>}
        </select>
        <button className="lx-btn lx-btn-ghost" type="button" onClick={() => void run("keyframe_create_effect")}>
          新建
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!effect}
          onClick={() => effect && void run("keyframe_duplicate_effect", { effectId: effect.id })}
        >
          复制
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!effect}
          onClick={() => effect && void run("keyframe_delete_effect", { effectId: effect.id })}
        >
          删除
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!effect || selection.fixtureIds.length === 0}
          onClick={() => void applyToSelection()}
          title={
            activeAttributes.length === 0
              ? "先在编程器里调一个属性"
              : "把效果应用到当前选中的灯，进入编程器；随后按 Store 选插槽存下"
          }
        >
          应用 {selection.fixtureIds.length > 0 ? `(${selection.fixtureIds.length})` : ""}
        </button>
        <div style={{ flex: 1 }} />
        {effect && (
          <input
            className="lx-input lx-input-sm"
            value={effect.name}
            onChange={(event) => applyEffect({ ...effect, name: event.currentTarget.value })}
            style={{ width: 150 }}
          />
        )}
      </div>

      {effect ? (
        <div style={bodyStyle}>
          {/* 轨道列表 */}
          <div style={trackPanelStyle}>
            <div style={panelHeadStyle}>轨道</div>
            <div style={trackListStyle}>
              {effect.tracks.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedTrackId(item.id);
                    setSelectedKeyframe(null);
                  }}
                  style={{
                    ...trackRowStyle,
                    borderColor:
                      item.id === track?.id ? "var(--lx-accent-bright)" : "rgba(255,255,255,0.08)",
                    opacity: item.enabled ? 1 : 0.45,
                  }}
                >
                  <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
                    <strong style={ellipsisStyle}>{item.attribute}</strong>
                    <small className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                      {item.keyframes.length} 帧 · {item.layer === "relative" ? "相对" : "绝对"}
                    </small>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      className="lx-btn lx-btn-ghost"
                      type="button"
                      title={item.enabled ? "停用" : "启用"}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateTrack({ ...item, enabled: !item.enabled });
                      }}
                    >
                      {item.enabled ? "On" : "Off"}
                    </button>
                    <button
                      className="lx-btn lx-btn-ghost"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeTrack(item.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
              {effect.tracks.length === 0 && <div style={emptyHintStyle}>还没有轨道</div>}
            </div>

            <div style={panelHeadStyle}>编程器里已调的属性</div>
            <div style={attributeListStyle}>
              {selection.fixtureIds.length === 0 && (
                <div style={emptyHintStyle}>先选灯</div>
              )}
              {selection.fixtureIds.length > 0 && activeAttributes.length === 0 && (
                <div style={emptyHintStyle}>
                  先在编程器里调一个属性 —— 效果驱动的就是你调过的东西
                </div>
              )}
              {activeAttributes.map((item) => {
                const partial = item.fixtureCount < item.totalFixtures;
                return (
                  <button
                    key={item.attribute}
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    onClick={() => addTrack(item.attribute, item.featureGroup)}
                    title={`${item.featureGroup} · 现值 ${
                      item.value === null ? "—" : round(item.value)
                    }${partial ? ` · 仅 ${item.fixtureCount}/${item.totalFixtures} 盏` : ""}`}
                    style={{ justifyContent: "space-between" }}
                  >
                    <span style={ellipsisStyle}>{item.attribute}</span>
                    <small className="lx-code" style={{ color: "var(--lx-accent-bright)" }}>
                      {item.value === null ? "—" : round(item.value)}
                    </small>
                  </button>
                );
              })}
            </div>

            {/* 灯库里还有但编程器没碰过的属性，收在后面备用 */}
            {otherAttributes.length > 0 && (
              <>
                <div style={panelHeadStyle}>灯库其余属性</div>
                <div style={attributeListStyle}>
                  {otherAttributes.map((option) => (
                    <button
                      key={option.name}
                      className="lx-btn lx-btn-ghost"
                      type="button"
                      onClick={() => addTrack(option.name, option.featureGroup)}
                      title={option.featureGroup}
                      style={{ justifyContent: "space-between", opacity: 0.6 }}
                    >
                      <span style={ellipsisStyle}>{option.name}</span>
                      <small className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                        {option.featureGroup}
                      </small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 曲线 + 参数 */}
          <div style={curveColumnStyle}>
            <div style={curveBoxStyle}>
              {track ? (
                <CurveEditor
                  keyframes={track.keyframes}
                  selectedIndex={selectedKeyframe}
                  onSelect={setSelectedKeyframe}
                  onChange={updateKeyframes}
                  playhead={previewAngle}
                />
              ) : (
                <div style={emptyHintStyle}>选一条轨道，或先加一条</div>
              )}
            </div>

            {/* 选中帧 */}
            <div style={rowStyle}>
              <span style={labelStyle}>选中帧</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={frame ? round(frame.angle) : ""}
                disabled={!frame}
                onChange={(event) =>
                  updateSelectedKeyframe({ angle: clampAngle(Number(event.currentTarget.value)) })
                }
                style={{ width: 74 }}
                title="角度"
              />
              <span style={unitStyle}>°</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={frame ? round(frame.value) : ""}
                disabled={!frame}
                onChange={(event) => updateSelectedKeyframe({ value: Number(event.currentTarget.value) })}
                style={{ width: 84 }}
                title="值"
              />
              <select
                className="lx-input lx-input-sm"
                value={frame?.interpolation ?? "linear"}
                disabled={!frame}
                onChange={(event) =>
                  updateSelectedKeyframe({ interpolation: event.currentTarget.value as Interpolation })
                }
                style={{ width: 92 }}
                title="到下一帧的过渡方式"
              >
                {INTERPOLATION_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button className="lx-btn lx-btn-ghost" type="button" disabled={!frame} onClick={deleteSelectedKeyframe}>
                删除帧
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={!track}
                onClick={() =>
                  track &&
                  updateTrack({ ...track, keyframes: sortKeyframes(curveFor(track.attribute)) })
                }
                title="回到首尾两帧的默认曲线"
              >
                重置曲线
              </button>
            </div>

            {/* 贝塞尔控制柄，只在选中帧用贝塞尔时才有意义 */}
            {frame?.interpolation === "bezier" && (
              <div style={rowStyle}>
                <span style={labelStyle}>控制柄</span>
                <span style={unitStyle}>出</span>
                <input
                  className="lx-input lx-input-sm"
                  type="number"
                  step={0.05}
                  value={round(frame.handleOut.dx)}
                  onChange={(event) =>
                    updateSelectedKeyframe({
                      handleOut: { ...frame.handleOut, dx: Number(event.currentTarget.value) },
                    })
                  }
                  style={{ width: 70 }}
                  title="横向"
                />
                <input
                  className="lx-input lx-input-sm"
                  type="number"
                  step={0.05}
                  value={round(frame.handleOut.dy)}
                  onChange={(event) =>
                    updateSelectedKeyframe({
                      handleOut: { ...frame.handleOut, dy: Number(event.currentTarget.value) },
                    })
                  }
                  style={{ width: 70 }}
                  title="纵向，超出 0..1 会过冲"
                />
                <span style={unitStyle}>入</span>
                <input
                  className="lx-input lx-input-sm"
                  type="number"
                  step={0.05}
                  value={round(frame.handleIn.dx)}
                  onChange={(event) =>
                    updateSelectedKeyframe({
                      handleIn: { ...frame.handleIn, dx: Number(event.currentTarget.value) },
                    })
                  }
                  style={{ width: 70 }}
                />
                <input
                  className="lx-input lx-input-sm"
                  type="number"
                  step={0.05}
                  value={round(frame.handleIn.dy)}
                  onChange={(event) =>
                    updateSelectedKeyframe({
                      handleIn: { ...frame.handleIn, dy: Number(event.currentTarget.value) },
                    })
                  }
                  style={{ width: 70 }}
                />
              </div>
            )}

            {/* 播放 */}
            <div style={rowStyle}>
              <span style={labelStyle}>周期</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                min={10}
                step={50}
                value={Math.round(effect.cycleMs)}
                onChange={(event) =>
                  applyEffect({ ...effect, cycleMs: Number(event.currentTarget.value) })
                }
                style={{ width: 88 }}
                title="跑完一圈要多久 —— 这就是速度"
              />
              <span style={unitStyle}>ms</span>
              {PLAYBACK_LABELS.map((item) => (
                <button
                  key={item.kind}
                  className="lx-btn lx-btn-ghost"
                  type="button"
                  title={item.hint}
                  onClick={() =>
                    applyEffect({
                      ...effect,
                      playback:
                        item.kind === "repeat"
                          ? { kind: "repeat", count: effect.playback.count ?? 2 }
                          : { kind: item.kind },
                    })
                  }
                  style={{
                    borderColor:
                      effect.playback.kind === item.kind
                        ? "var(--lx-accent-bright)"
                        : "rgba(255,255,255,0.08)",
                    color:
                      effect.playback.kind === item.kind ? "var(--lx-accent-bright)" : undefined,
                  }}
                >
                  {item.label}
                </button>
              ))}
              {effect.playback.kind === "repeat" && (
                <>
                  <input
                    className="lx-input lx-input-sm"
                    type="number"
                    min={1}
                    value={effect.playback.count ?? 2}
                    onChange={(event) =>
                      applyEffect({
                        ...effect,
                        playback: { kind: "repeat", count: Math.max(1, Number(event.currentTarget.value)) },
                      })
                    }
                    style={{ width: 62 }}
                  />
                  <span style={unitStyle}>圈</span>
                </>
              )}
            </div>

            {/* 相位分布 */}
            <div style={rowStyle}>
              <span style={labelStyle}>相位</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                step={15}
                value={round(effect.phase.spread)}
                onChange={(event) =>
                  applyEffect({
                    ...effect,
                    phase: { ...effect.phase, spread: Number(event.currentTarget.value) },
                  })
                }
                style={{ width: 78 }}
                title="整组从头到尾铺开多少度。360 = 首尾差一整圈"
              />
              <span style={unitStyle}>°</span>
              {(
                [
                  ["组", "groups", "整条效果在选择上重复几遍"],
                  ["块", "blocks", "每几盏灯算一个整体"],
                  ["翼", "wings", "分成几段，偶数段镜像"],
                ] as const
              ).map(([label, key, hint]) => (
                <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={unitStyle}>{label}</span>
                  <input
                    className="lx-input lx-input-sm"
                    type="number"
                    min={1}
                    value={effect.phase[key]}
                    onChange={(event) =>
                      applyEffect({
                        ...effect,
                        phase: {
                          ...effect.phase,
                          [key]: Math.max(1, Number(event.currentTarget.value)),
                        },
                      })
                    }
                    style={{ width: 56 }}
                    title={hint}
                  />
                </span>
              ))}
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                onClick={() =>
                  applyEffect({
                    ...effect,
                    phase: { ...effect.phase, reverse: !effect.phase.reverse },
                  })
                }
                style={{
                  borderColor: effect.phase.reverse ? "var(--lx-accent-bright)" : "rgba(255,255,255,0.08)",
                }}
                title="反向铺开"
              >
                反向
              </button>
              <div style={{ flex: 1 }} />
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                选中 {selection.fixtureIds.length} 盏
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div style={emptyHintStyle}>没有效果。点"新建"开始。</div>
      )}

      <div style={statusStyle}>
        <span>{status}</span>
        <span>
          {effect
            ? `${effect.tracks.length} 轨道 · 一圈 ${CYCLE_DEGREES}° / ${Math.round(effect.cycleMs)}ms`
            : ""}
        </span>
      </div>
    </div>
  );
}

/** 本地预览播放头。与后端求值同构，只用于显示。 */
function previewAngleFor(effect: KeyframeEffect, elapsedMs: number): number | null {
  const cycle = effect.cycleMs;
  if (!Number.isFinite(cycle) || cycle <= 0) return null;
  const cycles = elapsedMs / cycle;

  switch (effect.playback.kind) {
    case "reverse":
      return ((1 - fract(cycles)) % 1) * CYCLE_DEGREES;
    case "pingPong": {
      const doubled = fract(cycles / 2) * 2;
      return (doubled <= 1 ? doubled : 2 - doubled) * CYCLE_DEGREES;
    }
    case "once":
      return cycles >= 1 ? 0 : cycles * CYCLE_DEGREES;
    case "repeat": {
      const count = Math.max(1, effect.playback.count ?? 1);
      return cycles >= count ? 0 : fract(cycles) * CYCLE_DEGREES;
    }
    default:
      return fract(cycles) * CYCLE_DEGREES;
  }
}

function fract(value: number): number {
  const fractional = value - Math.floor(value);
  return fractional < 0 ? fractional + 1 : fractional;
}


function clampAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.min(CYCLE_DEGREES - 0.001, Math.max(0, angle));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── 样式 ────────────────────────────────────────────────────

const rootStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "38px minmax(0, 1fr) 24px",
  height: "100%",
  minHeight: 0,
  background: "var(--lx-bg-abyss)",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 8px",
  borderBottom: "1px solid var(--lx-stroke)",
  background: "rgba(255,255,255,0.035)",
  overflowX: "auto",
};

const badgeStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 24,
  height: 24,
  flex: "0 0 auto",
  borderRadius: 3,
  background: "rgba(240,157,28,0.16)",
  color: "var(--lx-accent-bright)",
  fontWeight: 900,
  fontSize: 11,
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "184px minmax(0, 1fr)",
  minHeight: 0,
  overflow: "hidden",
};

const trackPanelStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto auto",
  minHeight: 0,
  borderRight: "1px solid var(--lx-stroke)",
  background: "rgba(0,0,0,0.18)",
};

const panelHeadStyle: CSSProperties = {
  padding: "5px 8px",
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const trackListStyle: CSSProperties = {
  display: "grid",
  gap: 3,
  alignContent: "start",
  padding: 5,
  minHeight: 0,
  overflowY: "auto",
};

const trackRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 4,
  padding: "4px 5px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-xs)",
  background: "rgba(0,0,0,0.24)",
  cursor: "pointer",
  fontSize: 11,
};

const attributeListStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  alignContent: "start",
  padding: 5,
  maxHeight: 168,
  overflowY: "auto",
};

const curveColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto auto auto",
  gap: 5,
  minHeight: 0,
  padding: 8,
};

const curveBoxStyle: CSSProperties = {
  minHeight: 0,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-sm)",
  background: "var(--lx-bg-void)",
  overflow: "hidden",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  flexWrap: "wrap",
};

const labelStyle: CSSProperties = {
  minWidth: 48,
  color: "var(--lx-fg-secondary)",
  fontSize: 11,
  fontWeight: 800,
};

const unitStyle: CSSProperties = {
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
};

const ellipsisStyle: CSSProperties = {
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  fontSize: 11,
};

const emptyHintStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  padding: 16,
  color: "var(--lx-fg-tertiary)",
  fontSize: 11,
};

const statusStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 8px",
  borderTop: "1px solid var(--lx-stroke)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
};
