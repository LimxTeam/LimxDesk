import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CurveEditor } from "./keyframe/CurveEditor";
import {
  CYCLE_DEGREES,
  frameValue,
  sortFrames,
  type Interpolation,
  type Keyframe,
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
 * 一帧横跨所有属性：颜色是 R/G/B 三个值同时成立的一件事，位置是 Pan/Tilt
 * 一起构成的一个朝向，拆开记就不成其为颜色或朝向了。图上一次看一个属性的
 * 曲线，其余属性以淡色作参考。
 *
 * 模板不含灯具。选灯之后点「应用」，效果落到编程器的效果层上；随后按 Store
 * 选一个插槽，它跟编程器里的其他内容一起进 cue。
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

/** 参与效果的属性。停用只是不再驱动它，帧里的值仍然保留。 */
interface EffectAttribute {
  attribute: string;
  featureGroup: string;
  layer: TrackLayer;
  enabled: boolean;
}

interface KeyframeEffect {
  id: string;
  number: number;
  name: string;
  cycleMs: number;
  playback: PlaybackMode;
  phase: PhaseSpread;
  attributes: EffectAttribute[];
  frames: Keyframe[];
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
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
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

  const attribute = useMemo(() => {
    const list = effect?.attributes ?? [];
    return (
      list.find((item) => item.attribute === selectedAttribute)?.attribute ??
      list[0]?.attribute ??
      null
    );
  }, [effect, selectedAttribute]);

  const ghostAttributes = useMemo(
    () =>
      (effect?.attributes ?? [])
        .filter((item) => item.enabled && item.attribute !== attribute)
        .map((item) => item.attribute),
    [effect, attribute],
  );

  const selectedFrame = useMemo(
    () => effect?.frames.find((frame) => frame.id === selectedFrameId) ?? null,
    [effect, selectedFrameId],
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
      setSelectedFrameId(null);
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
      setStatus(`已在 ${captureAngle}° 打帧：${captured}`);
      // 打完自动挪到下一个常用落点，连着打不用每次改角度。
      setCaptureAngle((current) => nextAnglePreset(current));
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function removeFrame(frameId: string) {
    if (!effect) return;
    flushPendingSave();
    try {
      setDocument(
        await invoke<KeyframeLibraryDocument>("keyframe_remove_frame", {
          effectId: effect.id,
          frameId,
        }),
      );
      setSelectedFrameId(null);
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

  /** 拖动图上的点：改这一帧的角度，以及它在当前属性上的取值。 */
  function moveFrame(frameId: string, angle: number, value: number) {
    if (!effect || !attribute) return;
    const frames = effect.frames.map((frame) => {
      if (frame.id !== frameId) return frame;
      const values = frame.values.some((item) => item.attribute === attribute)
        ? frame.values.map((item) =>
            item.attribute === attribute ? { ...item, value } : item,
          )
        : [...frame.values, { attribute, value }];
      return { ...frame, angle, values };
    });
    applyEffect({ ...effect, frames: sortFrames(frames) });
  }

  function patchFrame(frameId: string, patch: Partial<Keyframe>) {
    if (!effect) return;
    applyEffect({
      ...effect,
      frames: sortFrames(
        effect.frames.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)),
      ),
    });
  }

  function setFrameValue(frameId: string, value: number) {
    if (!effect || !attribute) return;
    moveFrame(frameId, effect.frames.find((frame) => frame.id === frameId)?.angle ?? 0, value);
  }

  function toggleAttribute(name: string) {
    if (!effect) return;
    applyEffect({
      ...effect,
      attributes: effect.attributes.map((item) =>
        item.attribute === name ? { ...item, enabled: !item.enabled } : item,
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
        <div style={{ flex: 1 }} />
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
                  style={{ width: 62 }}
                  title="在周期的哪个角度记这一帧"
                />
                <span style={unitStyle}>°</span>
                <div style={{ display: "flex", gap: 2 }}>
                  {ANGLE_PRESETS.map((angle) => (
                    <button
                      key={angle}
                      className="lx-btn lx-btn-ghost"
                      type="button"
                      onClick={() => setCaptureAngle(angle)}
                      style={{
                        padding: "0 5px",
                        borderColor:
                          captureAngle === angle ? "var(--lx-accent-bright)" : undefined,
                      }}
                    >
                      {angle}
                    </button>
                  ))}
                </div>
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

            <div style={panelHeadStyle}>帧 · {effect.frames.length}</div>
            <div style={listStyle}>
              {effect.frames.length === 0 && (
                <div style={emptyHintStyle}>一帧都还没打</div>
              )}
              {effect.frames.map((frame) => (
                <div
                  key={frame.id}
                  onClick={() => setSelectedFrameId(frame.id)}
                  style={{
                    ...rowStyle,
                    borderColor:
                      frame.id === selectedFrameId
                        ? "var(--lx-accent-bright)"
                        : "rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
                    <strong className="lx-code">{round(frame.angle)}°</strong>
                    <small style={ellipsisStyle} title={frame.values.map((v) => v.attribute).join(", ")}>
                      {frame.values.length} 个属性
                    </small>
                  </div>
                  <button
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeFrame(frame.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div style={panelHeadStyle}>属性</div>
            <div style={listStyle}>
              {effect.attributes.length === 0 && (
                <div style={emptyHintStyle}>打帧后属性会自动登记</div>
              )}
              {effect.attributes.map((item) => (
                <div
                  key={item.attribute}
                  onClick={() => setSelectedAttribute(item.attribute)}
                  style={{
                    ...rowStyle,
                    borderColor:
                      item.attribute === attribute
                        ? "var(--lx-accent-bright)"
                        : "rgba(255,255,255,0.08)",
                    opacity: item.enabled ? 1 : 0.45,
                  }}
                >
                  <span style={ellipsisStyle}>{item.attribute}</span>
                  <button
                    className="lx-btn lx-btn-ghost"
                    type="button"
                    title={item.enabled ? "停用（帧里的值保留）" : "启用"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleAttribute(item.attribute);
                    }}
                  >
                    {item.enabled ? "On" : "Off"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 右栏：曲线 + 参数 */}
          <div style={curveColumnStyle}>
            <div style={curveBoxStyle}>
              {effect.frames.length > 0 && attribute ? (
                <CurveEditor
                  frames={effect.frames}
                  attribute={attribute}
                  ghostAttributes={ghostAttributes}
                  selectedFrameId={selectedFrameId}
                  onSelect={setSelectedFrameId}
                  onMove={moveFrame}
                  playhead={previewAngle}
                />
              ) : (
                <div style={emptyHintStyle}>
                  把灯调成想要的样子，按「打帧」记下第一帧
                </div>
              )}
            </div>

            {/* 选中帧 */}
            <div style={paramRowStyle}>
              <span style={labelStyle}>选中帧</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={selectedFrame ? round(selectedFrame.angle) : ""}
                disabled={!selectedFrame}
                onChange={(event) =>
                  selectedFrame &&
                  patchFrame(selectedFrame.id, {
                    angle: clampAngle(Number(event.currentTarget.value)),
                  })
                }
                style={{ width: 70 }}
                title="角度"
              />
              <span style={unitStyle}>°</span>
              <input
                className="lx-input lx-input-sm"
                type="number"
                value={
                  selectedFrame && attribute
                    ? (frameValue(selectedFrame, attribute) ?? "")
                    : ""
                }
                disabled={!selectedFrame || !attribute}
                onChange={(event) =>
                  selectedFrame && setFrameValue(selectedFrame.id, Number(event.currentTarget.value))
                }
                style={{ width: 84 }}
                title={attribute ? `${attribute} 的取值` : "取值"}
              />
              <select
                className="lx-input lx-input-sm"
                value={selectedFrame?.interpolation ?? "smooth"}
                disabled={!selectedFrame}
                onChange={(event) =>
                  selectedFrame &&
                  patchFrame(selectedFrame.id, {
                    interpolation: event.currentTarget.value as Interpolation,
                  })
                }
                style={{ width: 88 }}
                title="到下一帧的过渡方式"
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
                disabled={!selectedFrame}
                onClick={() => selectedFrame && void removeFrame(selectedFrame.id)}
              >
                删除帧
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="lx-btn lx-btn-ghost"
                type="button"
                disabled={!selectedFrame || !canCapture}
                onClick={() => {
                  if (!selectedFrame) return;
                  setCaptureAngle(selectedFrame.angle);
                  void captureFrame();
                }}
                title="用编程器里此刻的值覆盖这一帧"
              >
                重录此帧
              </button>
            </div>

            {/* 播放 */}
            <div style={paramRowStyle}>
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
            <div style={paramRowStyle}>
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
              <div style={{ flex: 1 }} />
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                选中 {selection.fixtureIds.length} 盏
              </span>
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
            ? `${effect.frames.length} 帧 · 一圈 ${CYCLE_DEGREES}° / ${Math.round(effect.cycleMs)}ms`
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

/** 打完一帧后挪到下一个常用落点，连着打不用每次改角度。 */
function nextAnglePreset(current: number): number {
  return ANGLE_PRESETS.find((angle) => angle > current) ?? ANGLE_PRESETS[0];
}

function clampAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return Math.min(CYCLE_DEGREES - 1, Math.max(0, Math.round(angle)));
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
  gridTemplateColumns: "178px minmax(0, 1fr)",
  minHeight: 0,
  overflow: "hidden",
};

const sidePanelStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto auto auto minmax(0, 1fr) auto minmax(0, 1fr)",
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
  gap: 4,
  padding: 6,
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  alignContent: "start",
  padding: 5,
  minHeight: 0,
  overflowY: "auto",
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

const paramRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  flexWrap: "wrap",
};

const labelStyle: CSSProperties = {
  minWidth: 46,
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
