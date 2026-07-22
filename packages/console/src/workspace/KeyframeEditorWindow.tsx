import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CurveEditor } from "./keyframe/CurveEditor";
import {
  clampToTrack,
  CYCLE_DEGREES,
  sortPoints,
  type Interpolation,
  type KeyframeTrack,
  type TrackPoint,
} from "./keyframe/curve";
import { clearWorkspaceRuntimeCache } from "./workspaceRuntime";

/**
 * 关键帧效果编辑器。
 *
 * 工作方式是"记录"，不是"生成"：把灯调成想要的样子，按「打帧」记下这一刻
 * 所有已激活属性的值；再调一次、再打一帧，效果就在两帧之间跑。要让灯从红
 * 跑到蓝，就调成红打一帧、调成蓝打一帧 —— 没有任何东西替你决定跑什么，
 * 那是预制效果的事。
 *
 * 打帧是跨属性的一次动作 —— 颜色是 R/G/B 同时成立的一件事，必须一起记。
 * 但记下之后每个属性有自己独立的轨道：亮度可以只用两个点、颜色用四个，
 * 挪动亮度的点不会连带拖走颜色。图上一次编辑一条轨道，其余以淡色作参考。
 *
 * 模板不含灯具。选灯之后点「应用」，效果落到编程器的效果层上；随后按 Store
 * 选一个插槽，它跟编程器里的其他内容一起进 cue。
 */

// ── 契约类型（对应 limxdesk-keyframe） ──────────────────────

type PlaybackKind = "loop" | "pingPong" | "reverse" | "once" | "repeat";

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

/** 编程器里已激活的属性 —— 打帧时被记录的就是这些。 */
interface ActiveAttribute {
  attribute: string;
  featureGroup: string;
  value: number | null;
  fixtureCount: number;
  totalFixtures: number;
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

/** 打帧角度的快捷位置。四分之一圈是最常用的落点。 */
const ANGLE_PRESETS = [0, 90, 180, 270];

export function KeyframeEditorWindow() {
  const [document, setDocument] = useState<KeyframeLibraryDocument>({
    effects: [],
    selectedEffectId: null,
    version: 0,
  });
  // 多选轨道。RGBW 这类分量本来就该一起调，一条条来没有意义。
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [phaseNudge, setPhaseNudge] = useState(30);
  const [captureAngle, setCaptureAngle] = useState(0);
  const [status, setStatus] = useState("No show loaded");
  const [previewAngle, setPreviewAngle] = useState<number | null>(null);
  const [activeAttributes, setActiveAttributes] = useState<ActiveAttribute[]>([]);
  const [selection, setSelection] = useState<FixtureSelection>({
    fixtureIds: [],
    primaryFixtureId: null,
    version: 0,
  });

  // 编辑本地即时生效，落盘另行节流 —— 拖一次曲线不该写十几次 show 文件。
  const pendingSaveRef = useRef<KeyframeEffect | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const effect = useMemo(
    () =>
      document.effects.find((item) => item.id === document.selectedEffectId) ??
      document.effects[0] ??
      null,
    [document.effects, document.selectedEffectId],
  );

  /** 实际选中的轨道。没选时落到第一条，避免空窗。 */
  const selectedTracks = useMemo(() => {
    const list = effect?.tracks ?? [];
    const picked = list.filter((item) => selectedAttributes.includes(item.attribute));
    return picked.length > 0 ? picked : list.slice(0, 1);
  }, [effect, selectedAttributes]);

  /** 主轨道：图上可拖动的那条，取选中里的第一条。 */
  const track = selectedTracks[0] ?? null;

  const peerTracks = useMemo(
    () => selectedTracks.filter((item) => item.attribute !== track?.attribute && item.points.length > 0),
    [selectedTracks, track],
  );

  const ghostTracks = useMemo(
    () =>
      (effect?.tracks ?? []).filter(
        (item) =>
          item.enabled &&
          item.points.length > 0 &&
          !selectedTracks.some((picked) => picked.attribute === item.attribute),
      ),
    [effect, selectedTracks],
  );

  /** 按 feature group 归拢轨道，便于整组选中。 */
  const trackGroups = useMemo(() => {
    const groups = new Map<string, KeyframeTrack[]>();
    for (const item of effect?.tracks ?? []) {
      const key = item.featureGroup || "Other";
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.entries());
  }, [effect]);

  const selectedPoint = useMemo(
    () => track?.points.find((point) => point.id === selectedPointId) ?? null,
    [track, selectedPointId],
  );

  /** 点击轨道：默认单选，Ctrl/Cmd 加选，Shift 选整个 feature group。 */
  function pickTrack(item: KeyframeTrack, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    setSelectedPointId(null);
    if (event.shiftKey) {
      const group = (effect?.tracks ?? [])
        .filter((candidate) => (candidate.featureGroup || "Other") === (item.featureGroup || "Other"))
        .map((candidate) => candidate.attribute);
      setSelectedAttributes(group);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedAttributes((current) =>
        current.includes(item.attribute)
          ? current.filter((name) => name !== item.attribute)
          : [...current, item.attribute],
      );
      return;
    }
    setSelectedAttributes([item.attribute]);
  }

  function selectGroup(attributes: string[]) {
    setSelectedAttributes(attributes);
    setSelectedPointId(null);
  }

  /** 对所有选中轨道做同一件事。 */
  function patchSelectedTracks(update: (item: KeyframeTrack) => KeyframeTrack) {
    if (!effect) return;
    const picked = new Set(selectedTracks.map((item) => item.attribute));
    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) => (picked.has(item.attribute) ? update(item) : item)),
    });
  }

  /**
   * 把选中轨道的所有点整体平移。
   *
   * RGBW 之间的相对关系要保住，所以是整条轨道一起挪，而不是逐点去改。
   */
  function nudgePhase(delta: number) {
    patchSelectedTracks((item) => ({
      ...item,
      points: sortPoints(
        item.points.map((point) => ({
          ...point,
          angle: (((point.angle + delta) % CYCLE_DEGREES) + CYCLE_DEGREES) % CYCLE_DEGREES,
        })),
      ),
    }));
  }

  /** 在选中轨道之间铺开相位：第一条不动，最后一条差 spread 度。 */
  function fanPhase(spread: number) {
    if (!effect || selectedTracks.length < 2) return;
    const order = selectedTracks.map((item) => item.attribute);
    const step = spread / order.length;
    const picked = new Map(order.map((attribute, index) => [attribute, index * step]));

    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) => {
        const offset = picked.get(item.attribute);
        if (offset === undefined) return item;
        return {
          ...item,
          points: sortPoints(
            item.points.map((point) => ({
              ...point,
              angle: (((point.angle + offset) % CYCLE_DEGREES) + CYCLE_DEGREES) % CYCLE_DEGREES,
            })),
          ),
        };
      }),
    });
  }

  useEffect(() => {
    void load();
    void invoke<FixtureSelection>("fixture_selection_get").then(setSelection).catch(() => {});
    return () => flushPendingSave();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const changed = await listen("keyframe:changed", () => void load());
      const selectionChanged = await listen<FixtureSelection>(
        "fixture-selection:changed",
        (event) => setSelection(event.payload),
      );
      const showLoaded = await listen("show:loaded", () => void load());
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

  // 编程器里已激活的属性。打帧记录的就是这些，因此要跟着编程器变。
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

  // 预览播放头：按效果的周期与模式在本地推进，纯显示用途。
  useEffect(() => {
    if (!effect) {
      setPreviewAngle(null);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const step = () => {
      setPreviewAngle(previewAngleFor(effect, performance.now() - startedAt));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [effect?.id, effect?.cycleMs, effect?.playback.kind, effect?.playback.count]);

  async function load() {
    try {
      const next = await invoke<KeyframeLibraryDocument>("keyframe_load_current_show");
      setDocument(next);
      setStatus(
        next.effects.length === 0
          ? "还没有效果"
          : `${next.effects.length} 个效果`,
      );
    } catch (error) {
      setDocument({ effects: [], selectedEffectId: null, version: 0 });
      setStatus(String(error));
    }
  }

  /** 本地立即生效，落盘延后合并。 */
  const applyEffect = useCallback((next: KeyframeEffect) => {
    setDocument((current) => ({
      ...current,
      effects: current.effects.map((item) => (item.id === next.id ? next : item)),
    }));

    pendingSaveRef.current = next;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
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
      setDocument(await invoke<KeyframeLibraryDocument>(command, args));
      setSelectedPointId(null);
    } catch (error) {
      setStatus(String(error));
    }
  }

  /**
   * 打一帧：把编程器里此刻的值记在指定角度上。
   *
   * 这是关键帧的核心动作 —— 记录你已经调好的样子，而不是生成一条曲线。
   */
  async function captureFrame() {
    if (!effect) return;
    flushPendingSave();
    try {
      const next = await invoke<KeyframeLibraryDocument>("keyframe_capture_frame", {
        effectId: effect.id,
        angle: captureAngle,
      });
      setDocument(next);
      clearWorkspaceRuntimeCache(["frames"]);
      const captured = activeAttributes.map((item) => item.attribute).join(", ");
      setStatus(`已在 ${captureAngle}° 记录：${captured}`);
      // 角度停在原处。自动跳到下一个落点看着省事，实际是让人在没注意的
      // 位置又打一帧 —— 打哪个角度该由手指决定。
    } catch (error) {
      setStatus(String(error));
    }
  }

  /**
   * 删点，作用于所有选中轨道上同一角度的点。
   *
   * 那些点是一次打帧记下的，删的是"那一刻"，不是某条轨道上孤立的一个点。
   */
  async function removePoint(pointId: string) {
    if (!effect || !track) return;
    const origin = track.points.find((point) => point.id === pointId);
    if (!origin) return;
    flushPendingSave();

    const targets = selectedTracks
      .map((item) => ({
        attribute: item.attribute,
        pointId:
          item.attribute === track.attribute
            ? pointId
            : item.points.find((point) => Math.abs(point.angle - origin.angle) < 0.001)?.id,
      }))
      .filter((target): target is { attribute: string; pointId: string } =>
        Boolean(target.pointId),
      );

    try {
      // 一次删完再落盘：逐条调用会写好几次盘，中途出错还会留下删了一半的状态。
      setDocument(
        await invoke<KeyframeLibraryDocument>("keyframe_remove_points", {
          effectId: effect.id,
          targets,
        }),
      );
      setSelectedPointId(null);
      clearWorkspaceRuntimeCache(["frames"]);
    } catch (error) {
      setStatus(String(error));
    }
  }

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

  /**
   * 改一个点，作用于所有选中的轨道。
   *
   * 角度与过渡方式跨轨道同步：一次打帧在各轨道上落在同一角度，RGBW 的相位
   * 本来就该一起动，否则选中四条却只有一条响应。同角度的点靠角度匹配 ——
   * 各轨道的点 id 各不相同，但捕获时刻是共同的。
   *
   * 值不同步：R 的 100 和 G 的 0 是各自的取值，统一改会把颜色抹平。
   */
  function patchPoint(pointId: string, patch: Partial<TrackPoint>) {
    if (!effect || !track) return;
    const origin = track.points.find((point) => point.id === pointId);
    if (!origin) return;

    // 取值钳进本轨道的量程 —— 输入框里敲个超范围的数不该被接受。
    const patched =
      patch.value === undefined
        ? patch
        : { ...patch, value: clampToTrack(track, patch.value) };
    const { value, ...shared } = patched;
    const hasShared = Object.keys(shared).length > 0;
    const picked = new Set(selectedTracks.map((item) => item.attribute));

    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) => {
        if (!picked.has(item.attribute)) return item;
        const primary = item.attribute === track.attribute;
        if (!primary && !hasShared) return item;

        return {
          ...item,
          points: sortPoints(
            item.points.map((point) => {
              const matches = primary
                ? point.id === pointId
                : Math.abs(point.angle - origin.angle) < 0.001;
              if (!matches) return point;
              return primary ? { ...point, ...patched } : { ...point, ...shared };
            }),
          ),
        };
      }),
    });
  }

  /** 在当前轨道上插一个点。曲线上双击走这里。 */
  function insertPoint(angle: number, value: number) {
    if (!effect || !track) return;
    // 同角度已有点就当作改值，避免叠出零长度的段。
    const existing = track.points.find((point) => Math.abs(point.angle - angle) < 0.5);
    if (existing) {
      patchPoint(existing.id, { value });
      setSelectedPointId(existing.id);
      return;
    }

    const created: TrackPoint = {
      id: crypto.randomUUID(),
      angle,
      value,
      interpolation: track.points[0]?.interpolation ?? "smooth",
      handleOut: { dx: 1 / 3, dy: 0 },
      handleIn: { dx: 1 / 3, dy: 0 },
    };
    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) =>
        item.id === track.id ? { ...item, points: sortPoints([...item.points, created]) } : item,
      ),
    });
    setSelectedPointId(created.id);
  }

  /** 删掉整条轨道。停用只是不驱动它，删掉才是真的不要了。 */
  function deleteTrack(trackId: string) {
    if (!effect) return;
    const removed = effect.tracks.find((item) => item.id === trackId);
    applyEffect({ ...effect, tracks: effect.tracks.filter((item) => item.id !== trackId) });
    if (removed) {
      setSelectedAttributes((current) => current.filter((name) => name !== removed.attribute));
    }
    setSelectedPointId(null);
  }

  function toggleTrack(trackId: string) {
    if (!effect) return;
    applyEffect({
      ...effect,
      tracks: effect.tracks.map((item) =>
        item.id === trackId ? { ...item, enabled: !item.enabled } : item,
      ),
    });
  }

  const canCapture = Boolean(effect) && activeAttributes.length > 0;

  return (
    <div style={rootStyle}>
      {/* 工具栏 */}
      <div style={toolbarStyle}>
        <span style={badgeStyle}>FX</span>
        <select
          className="lx-input lx-input-sm"
          value={effect?.id ?? ""}
          onChange={(event) =>
            void run("keyframe_select_effect", { effectId: event.currentTarget.value })
          }
          style={{ width: 180 }}
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
        <div className="lx-spacer" />
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!effect || selection.fixtureIds.length === 0}
          onClick={() => void applyToSelection()}
          title="把效果应用到选中的灯，进入编程器；随后按 Store 选插槽存下"
        >
          应用 {selection.fixtureIds.length > 0 ? `(${selection.fixtureIds.length})` : ""}
        </button>
        {effect && (
          <input
            className="lx-input lx-input-sm"
            value={effect.name}
            onChange={(event) => applyEffect({ ...effect, name: event.currentTarget.value })}
            style={{ width: 130 }}
          />
        )}
      </div>

      {effect ? (
        <div style={bodyStyle}>
          {/* 左栏：打帧 + 帧列表 + 属性 */}
          <div style={sidePanelStyle}>
            <div style={panelHeadStyle}>打帧</div>
            <div style={captureBoxStyle}>
              {/* 角度输入独占一行，四个快捷位在下面平分 —— 挤在同一行时
                  最后一个会被窄侧栏切掉。 */}
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  className="lx-input lx-input-sm"
                  type="number"
                  min={0}
                  max={359}
                  value={captureAngle}
                  onChange={(event) =>
                    setCaptureAngle(clampAngle(Number(event.currentTarget.value)))
                  }
                  style={{ flex: 1, minWidth: 0 }}
                  title="在周期的哪个角度记这一帧"
                />
                <span style={unitStyle}>°</span>
              </div>
              <div style={anglePresetRowStyle}>
                {ANGLE_PRESETS.map((angle) => (
                  <button
                    key={angle}
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    onClick={() => setCaptureAngle(angle)}
                    style={{
                      padding: 0,
                      minWidth: 0,
                      fontSize: 10,
                      borderColor:
                        captureAngle === angle ? "var(--lx-accent-bright)" : undefined,
                      color: captureAngle === angle ? "var(--lx-accent-bright)" : undefined,
                    }}
                  >
                    {angle}
                  </button>
                ))}
              </div>
              <button
                className="lx-btn"
                type="button"
                disabled={!canCapture}
                onClick={() => void captureFrame()}
                title={
                  activeAttributes.length === 0
                    ? "先把灯调成想要的样子 —— 打帧记录的是编程器里此刻的值"
                    : `记录 ${activeAttributes.map((item) => item.attribute).join(", ")}`
                }
                style={{
                  borderColor: canCapture ? "var(--lx-accent-bright)" : undefined,
                  color: canCapture ? "var(--lx-accent-bright)" : undefined,
                }}
              >
                + 打帧
              </button>
              <small style={{ color: "var(--lx-fg-tertiary)", fontSize: 10, lineHeight: 1.4 }}>
                {activeAttributes.length === 0
                  ? "先把灯调成想要的样子，再打帧"
                  : `将记录 ${activeAttributes.length} 个属性`}
              </small>
            </div>

            <div style={panelHeadStyle}>
              轨道{selectedTracks.length > 1 ? ` · 选中 ${selectedTracks.length}` : ""}
            </div>
            <div style={listStyle}>
              {effect.tracks.length === 0 && (
                <div style={emptyHintStyle}>打帧后轨道会自动建立</div>
              )}
              {trackGroups.map(([group, items]) => (
                <div key={group} style={{ display: "grid", gap: 2 }}>
                  <button
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    onClick={() => selectGroup(items.map((item) => item.attribute))}
                    title={`选中 ${group} 的全部 ${items.length} 条轨道`}
                    style={groupHeadStyle}
                  >
                    {group} · {items.length}
                  </button>
                  {items.map((item) => {
                    const picked = selectedTracks.some(
                      (candidate) => candidate.attribute === item.attribute,
                    );
                    return (
                      <div
                        key={item.id}
                        onClick={(event) => pickTrack(item, event)}
                        title="Ctrl 加选 · Shift 选整组"
                        style={{
                          ...rowStyle,
                          borderColor: picked
                            ? "var(--lx-accent-bright)"
                            : "rgba(255,255,255,0.08)",
                          background: picked ? "rgba(240,157,28,0.10)" : "rgba(0,0,0,0.24)",
                          opacity: item.enabled ? 1 : 0.45,
                        }}
                      >
                        <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
                          <strong style={ellipsisStyle}>
                            {item.attribute}
                            {item.attribute === track?.attribute && selectedTracks.length > 1
                              ? " ◂"
                              : ""}
                          </strong>
                          <small className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                            {item.points.length} 点{rangeHint(item)}
                          </small>
                        </div>
                        <div style={{ display: "flex", gap: 2 }}>
                          <button
                            className="lx-btn lx-btn-ghost"
                            type="button"
                            title={item.enabled ? "停用（点保留）" : "启用"}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleTrack(item.id);
                            }}
                          >
                            {item.enabled ? "On" : "Off"}
                          </button>
                          <button
                            className="lx-btn lx-btn-ghost"
                            type="button"
                            title="删掉整条轨道"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteTrack(item.id);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div style={panelHeadStyle}>
              {track
                ? `${track.attribute} · ${track.points.length} 点${
                    selectedTracks.length > 1 ? ` · 联动 ${selectedTracks.length}` : ""
                  }`
                : "关键点"}
            </div>
            <div style={listStyle}>
              {!track && <div style={emptyHintStyle}>先选一条轨道</div>}
              {track?.points.length === 0 && <div style={emptyHintStyle}>这条轨道还没有点</div>}
              {track?.points.map((point) => (
                <div
                  key={point.id}
                  onClick={() => setSelectedPointId(point.id)}
                  style={{
                    ...rowStyle,
                    borderColor:
                      point.id === selectedPointId
                        ? "var(--lx-accent-bright)"
                        : "rgba(255,255,255,0.08)",
                  }}
                >
                  <span className="lx-code" style={ellipsisStyle}>
                    {round(point.angle)}° · {round(point.value)}
                  </span>
                  <button
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removePoint(point.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 右栏：曲线 + 参数 */}
          <div style={curveColumnStyle}>
            <div style={curveBoxStyle}>
              {track && track.points.length > 0 ? (
                <CurveEditor
                  track={track}
                  peerTracks={peerTracks}
                  ghostTracks={ghostTracks}
                  selectedPointId={selectedPointId}
                  onSelect={setSelectedPointId}
                  // 左右拖是调相位，选中的轨道一起动；上下拖是改这条轨道
                  // 自己的取值。patchPoint 已经区分了这两者。
                  onMove={(pointId, angle, value) => patchPoint(pointId, { angle, value })}
                  onInsert={insertPoint}
                  playhead={previewAngle}
                />
              ) : (
                <div style={emptyHintStyle}>
                  把灯调成想要的样子，按「打帧」记下第一个点
                </div>
              )}
            </div>

            {/* 参数区：宽窗口两列，窄窗口一列 */}
            <div style={paramGridStyle}>
            {/* 选中点 */}
            <div className="lx-param-row" style={paramRowStyle}>
              <span style={labelStyle} title="曲线上双击可插入一个点">
                选中点
              </span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={selectedPoint ? round(selectedPoint.angle) : ""}
                disabled={!selectedPoint}
                onChange={(event) =>
                  selectedPoint &&
                  patchPoint(selectedPoint.id, {
                    angle: clampAngle(Number(event.currentTarget.value)),
                  })
                }
                style={{ width: 70 }}
                title={
                  selectedTracks.length > 1
                    ? `角度 —— ${selectedTracks.length} 条选中轨道一起动`
                    : "角度"
                }
              />
              <span style={unitStyle}>°</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={selectedPoint ? round(selectedPoint.value) : ""}
                disabled={!selectedPoint}
                onChange={(event) =>
                  selectedPoint &&
                  patchPoint(selectedPoint.id, { value: Number(event.currentTarget.value) })
                }
                style={{ width: 84 }}
                min={track?.minValue ?? undefined}
                max={track?.maxValue ?? undefined}
                title={
                  track
                    ? `${track.attribute} 的取值${rangeHint(track)} —— 只改这一条，各属性的值本就不同`
                    : "取值"
                }
              />
              <select
                className="lx-input lx-input-sm"
                value={selectedPoint?.interpolation ?? "smooth"}
                disabled={!selectedPoint}
                onChange={(event) =>
                  selectedPoint &&
                  patchPoint(selectedPoint.id, {
                    interpolation: event.currentTarget.value as Interpolation,
                  })
                }
                style={{ width: 88 }}
                title={
                  selectedTracks.length > 1
                    ? `到下一个点的过渡 —— ${selectedTracks.length} 条一起改`
                    : "到下一个点的过渡方式"
                }
              >
                {INTERPOLATION_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={!selectedPoint}
                onClick={() => selectedPoint && void removePoint(selectedPoint.id)}
              >
                删除点
              </button>
              <div className="lx-spacer" />
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={!selectedPoint || !canCapture}
                onClick={() => {
                  if (!selectedPoint) return;
                  setCaptureAngle(selectedPoint.angle);
                  void captureFrame();
                }}
                title="用编程器里此刻的值在这个角度重录"
              >
                重录
              </button>
            </div>

            {/* 选中轨道的批量操作 */}
            <div className="lx-param-row" style={paramRowStyle}>
              <span style={labelStyle}>
                {selectedTracks.length > 1 ? `${selectedTracks.length} 轨道` : "本轨道"}
              </span>
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={selectedTracks.length === 0}
                onClick={() => nudgePhase(-phaseNudge)}
                title="所有选中轨道的点整体前移"
              >
                ◂ 移相
              </button>
              <input
                className="lx-input lx-input-sm"
                type="number"
                step={5}
                value={phaseNudge}
                onChange={(event) => setPhaseNudge(Number(event.currentTarget.value) || 0)}
                style={{ width: 58 }}
              />
              <span style={unitStyle}>°</span>
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={selectedTracks.length === 0}
                onClick={() => nudgePhase(phaseNudge)}
                title="所有选中轨道的点整体后移"
              >
                移相 ▸
              </button>
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={selectedTracks.length < 2}
                onClick={() => fanPhase(CYCLE_DEGREES)}
                title="在选中的轨道之间均匀铺开一整圈 —— RGBW 这样铺就是跑色"
              >
                铺开
              </button>
              <select
                className="lx-input lx-input-sm"
                value=""
                disabled={selectedTracks.length === 0}
                onChange={(event) => {
                  const next = event.currentTarget.value as Interpolation;
                  if (!next) return;
                  patchSelectedTracks((item) => ({
                    ...item,
                    points: item.points.map((point) => ({ ...point, interpolation: next })),
                  }));
                  event.currentTarget.value = "";
                }}
                style={{ width: 96 }}
                title="把选中轨道的所有点改成同一种过渡"
              >
                <option value="">统一过渡…</option>
                {INTERPOLATION_LABELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={selectedTracks.length === 0}
                onClick={() =>
                  patchSelectedTracks((item) => ({ ...item, enabled: !item.enabled }))
                }
              >
                启停
              </button>
            </div>

            {/* 播放 */}
            <div className="lx-param-row" style={paramRowStyle}>
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
                style={{ width: 84 }}
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
                      effect.playback.kind === item.kind ? "var(--lx-accent-bright)" : undefined,
                    color: effect.playback.kind === item.kind ? "var(--lx-accent-bright)" : undefined,
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
                        playback: {
                          kind: "repeat",
                          count: Math.max(1, Number(event.currentTarget.value)),
                        },
                      })
                    }
                    style={{ width: 58 }}
                  />
                  <span style={unitStyle}>圈</span>
                </>
              )}
            </div>

            {/* 相位 */}
            <div className="lx-param-row" style={paramRowStyle}>
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
                style={{ width: 74 }}
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
                    style={{ width: 52 }}
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
                  borderColor: effect.phase.reverse ? "var(--lx-accent-bright)" : undefined,
                }}
                title="反向铺开"
              >
                反向
              </button>
              <div className="lx-spacer" />
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                选中 {selection.fixtureIds.length} 盏
              </span>
            </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={emptyHintStyle}>没有效果。点「新建」开始。</div>
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
  return Math.min(CYCLE_DEGREES - 1, Math.max(0, Math.round(angle)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 量程提示。未知时留空，不要显示一个假的范围。 */
function rangeHint(track: KeyframeTrack): string {
  const { minValue, maxValue } = track;
  if (minValue === null || maxValue === null) return "";
  return ` · ${round(minValue)}~${round(maxValue)}`;
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
  gap: 5,
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
  // 左栏跟着窗口收放。死宽在小窗口下会把曲线挤成一条缝。
  gridTemplateColumns: "clamp(132px, 21%, 186px) minmax(0, 1fr)",
  minHeight: 0,
  overflow: "hidden",
};

const sidePanelStyle: CSSProperties = {
  display: "grid",
  // 轨道列表比点列表更该看全 —— 轨道数是固定的几条，点可以滚。
  gridTemplateRows: "auto auto auto minmax(56px, 1.3fr) auto minmax(48px, 1fr)",
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

const captureBoxStyle: CSSProperties = {
  display: "grid",
  gap: 3,
  padding: 6,
};

/** 四个角度快捷位平分一行，窄侧栏也放得下。 */
const anglePresetRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 2,
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  alignContent: "start",
  padding: 5,
  minHeight: 0,
  overflowY: "auto",
};

const groupHeadStyle: CSSProperties = {
  justifyContent: "flex-start",
  padding: "1px 4px",
  border: "none",
  background: "transparent",
  color: "var(--lx-fg-tertiary)",
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 4,
  padding: "3px 5px",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-xs)",
  background: "rgba(0,0,0,0.24)",
  cursor: "pointer",
  fontSize: 11,
};

const curveColumnStyle: CSSProperties = {
  display: "grid",
  // 曲线拿到一个下限：它是这个窗口的主体，不该被参数区一路挤没。
  gridTemplateRows: "minmax(120px, 1fr) auto",
  gap: 6,
  minHeight: 0,
  padding: 8,
};

/**
 * 参数区。
 *
 * 宽窗口两列并排，窄窗口落成一列 —— 四块参数各自 flex-wrap 换行的话，
 * 高度会成倍长，曲线就被挤没了。
 */
const paramGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
  gap: "4px 12px",
  alignContent: "start",
};

const curveBoxStyle: CSSProperties = {
  minHeight: 0,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-sm)",
  background: "var(--lx-bg-void)",
  overflow: "hidden",
};

const paramRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  // 不换行：一行内放不下就横向滚，高度始终是一行。
  flexWrap: "nowrap",
  overflowX: "auto",
  minWidth: 0,
  paddingBottom: 1,
};

const labelStyle: CSSProperties = {
  flex: "0 0 auto",
  minWidth: 42,
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
  padding: 14,
  color: "var(--lx-fg-tertiary)",
  fontSize: 11,
  textAlign: "center",
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
