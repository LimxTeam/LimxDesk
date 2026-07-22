import { useCallback, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  CYCLE_DEGREES,
  curveFor,
  frameValue,
  normalizeAngle,
  sample,
  valueRange,
  type Keyframe,
} from "./curve";

/**
 * 关键帧曲线编辑器。
 *
 * 横轴是一个完整周期的 0..360 度，纵轴是所选属性的值。曲线闭环 ——
 * 末帧接回首帧。
 *
 * 一帧横跨多个属性，所以图上一个点代表的是"这一帧在当前所选属性上的取值"。
 * 拖动它只改这一个属性的值，帧里其他属性不受影响；左右拖则移动整帧的角度，
 * 因为角度是整帧共有的。
 */

/** 内部坐标系。SVG 用 viewBox 缩放到实际尺寸，交互换算只需按比例。 */
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 260;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** 曲线绘制的采样密度。每 2 度一个点，贝塞尔的弯折也能画准。 */
const SAMPLE_STEP = 2;

export interface CurveEditorProps {
  frames: Keyframe[];
  /** 当前在图上显示的属性 */
  attribute: string | null;
  /** 其余属性的曲线，淡色作为参考 */
  ghostAttributes: string[];
  selectedFrameId: string | null;
  onSelect: (frameId: string | null) => void;
  /** 拖动改变某帧的角度与当前属性上的取值 */
  onMove: (frameId: string, angle: number, value: number) => void;
  /** 当前播放角度，没有在跑时为 null */
  playhead: number | null;
}

export function CurveEditor({
  frames,
  attribute,
  ghostAttributes,
  selectedFrameId,
  onSelect,
  onMove,
  playhead,
}: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<string | null>(null);

  const points = useMemo(
    () => (attribute ? curveFor(frames, attribute) : []),
    [frames, attribute],
  );

  // 纵轴范围取整到"整齐"的边界，这样拖动时坐标轴不会一直跳。
  const range = useMemo(() => niceRange(valueRange(points)), [points]);

  const toX = useCallback((angle: number) => PAD_LEFT + (angle / CYCLE_DEGREES) * PLOT_WIDTH, []);
  const toY = useCallback(
    (value: number) => {
      const span = range.max - range.min || 1;
      return PAD_TOP + PLOT_HEIGHT - ((value - range.min) / span) * PLOT_HEIGHT;
    },
    [range],
  );

  const fromClient = useCallback(
    (clientX: number, clientY: number) => {
      const element = svgRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const viewX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH;
      const viewY = ((clientY - rect.top) / rect.height) * VIEW_HEIGHT;
      const angle = ((viewX - PAD_LEFT) / PLOT_WIDTH) * CYCLE_DEGREES;
      const span = range.max - range.min || 1;
      const value = range.min + ((PAD_TOP + PLOT_HEIGHT - viewY) / PLOT_HEIGHT) * span;
      return { angle, value };
    },
    [range],
  );

  const path = useMemo(() => buildPath(points, toX, toY), [points, toX, toY]);

  function handlePointerDown(event: ReactPointerEvent<SVGGElement>, frameId: string) {
    event.stopPropagation();
    onSelect(frameId);
    draggingRef.current = frameId;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGGElement>) {
    const frameId = draggingRef.current;
    if (!frameId || !attribute) return;
    const point = fromClient(event.clientX, event.clientY);
    if (!point) return;
    onMove(frameId, clampAngle(point.angle), round(point.value));
  }

  function handlePointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (draggingRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      draggingRef.current = null;
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      style={svgStyle}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <rect
        x={PAD_LEFT}
        y={PAD_TOP}
        width={PLOT_WIDTH}
        height={PLOT_HEIGHT}
        fill="rgba(0,0,0,0.28)"
        stroke="rgba(255,255,255,0.08)"
        onPointerDown={() => onSelect(null)}
      />

      {/* 角度刻度：每 90 度一条 */}
      {[0, 90, 180, 270, 360].map((angle) => (
        <g key={`grid-${angle}`}>
          <line
            x1={toX(angle)}
            y1={PAD_TOP}
            x2={toX(angle)}
            y2={PAD_TOP + PLOT_HEIGHT}
            stroke="rgba(255,255,255,0.07)"
            pointerEvents="none"
          />
          <text
            x={toX(angle)}
            y={VIEW_HEIGHT - 8}
            textAnchor="middle"
            fill="var(--lx-fg-tertiary)"
            fontSize={10}
            pointerEvents="none"
          >
            {angle}°
          </text>
        </g>
      ))}

      {/* 纵轴刻度 */}
      {[range.min, (range.min + range.max) / 2, range.max].map((value, index) => (
        <g key={`value-${index}`}>
          <line
            x1={PAD_LEFT}
            y1={toY(value)}
            x2={PAD_LEFT + PLOT_WIDTH}
            y2={toY(value)}
            stroke="rgba(255,255,255,0.06)"
            pointerEvents="none"
          />
          <text
            x={PAD_LEFT - 6}
            y={toY(value) + 3}
            textAnchor="end"
            fill="var(--lx-fg-tertiary)"
            fontSize={10}
            pointerEvents="none"
          >
            {formatValue(value)}
          </text>
        </g>
      ))}

      {/* 其余属性的曲线，淡色参考 —— 一帧里的属性是一起动的，
          只看一条容易忘了别的属性也在跑 */}
      {ghostAttributes.map((ghost) => (
        <path
          key={`ghost-${ghost}`}
          d={buildPath(curveFor(frames, ghost), toX, toYGhost(frames, ghost, toY, range))}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1}
          pointerEvents="none"
        />
      ))}

      {/* 当前属性的曲线 */}
      <path d={path} fill="none" stroke="var(--lx-accent-bright)" strokeWidth={2} pointerEvents="none" />

      {/* 播放头 */}
      {playhead !== null && (
        <line
          x1={toX(normalizeAngle(playhead))}
          y1={PAD_TOP}
          x2={toX(normalizeAngle(playhead))}
          y2={PAD_TOP + PLOT_HEIGHT}
          stroke="var(--lx-action-bright)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}

      {/* 帧点 */}
      {frames.map((frame) => {
        const value = attribute ? frameValue(frame, attribute) : null;
        const selected = frame.id === selectedFrameId;
        // 该帧没记录当前属性时，画在轴底并标成空心 —— 让人看得出
        // "这一帧存在，但没有这个属性的值"。
        const missing = value === null;
        const y = missing ? PAD_TOP + PLOT_HEIGHT : toY(value);
        return (
          <g
            key={frame.id}
            onPointerDown={(event) => handlePointerDown(event, frame.id)}
            style={{ cursor: "grab" }}
          >
            <circle cx={toX(frame.angle)} cy={y} r={11} fill="transparent" />
            <circle
              cx={toX(frame.angle)}
              cy={y}
              r={selected ? 6 : 4.5}
              fill={missing ? "transparent" : selected ? "var(--lx-accent-bright)" : "var(--lx-bg-deep)"}
              stroke={missing ? "var(--lx-fg-tertiary)" : "var(--lx-accent-bright)"}
              strokeWidth={2}
              strokeDasharray={missing ? "2 2" : undefined}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** 采样出曲线路径。整圈闭合，所以采到 360 度为止。 */
function buildPath(
  points: ReturnType<typeof curveFor>,
  toX: (angle: number) => number,
  toY: (value: number) => number,
): string {
  if (points.length === 0) return "";

  const segments: string[] = [];
  for (let angle = 0; angle <= CYCLE_DEGREES; angle += SAMPLE_STEP) {
    // 360 度处取 0 度的值，让曲线首尾接上。
    const value = sample(points, angle >= CYCLE_DEGREES ? 0 : angle);
    if (value === null) continue;
    segments.push(
      `${segments.length === 0 ? "M" : "L"}${toX(angle).toFixed(2)},${toY(value).toFixed(2)}`,
    );
  }
  return segments.join(" ");
}

/**
 * 参考曲线用自己的取值范围映射到同一张图上。
 *
 * 不同属性量纲差得远（Dimmer 0..100、Pan -270..270），共用一根纵轴的话
 * 其中一条会被压成直线，看不出形状。
 */
function toYGhost(
  frames: Keyframe[],
  attribute: string,
  _toY: (value: number) => number,
  _range: { min: number; max: number },
): (value: number) => number {
  const ghostRange = niceRange(valueRange(curveFor(frames, attribute)));
  const span = ghostRange.max - ghostRange.min || 1;
  return (value: number) =>
    PAD_TOP + PLOT_HEIGHT - ((value - ghostRange.min) / span) * PLOT_HEIGHT;
}

function clampAngle(angle: number): number {
  // 夹在 [0, 360) 而不是 wrap：拖到左边缘外应该停住，不该跳到右边。
  return Math.min(CYCLE_DEGREES - 0.001, Math.max(0, round(angle)));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 把范围扩到整齐的边界，减少拖拽时坐标轴的跳动。 */
function niceRange({ min, max }: { min: number; max: number }): { min: number; max: number } {
  const span = max - min;
  const step = niceStep(span);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
  };
}

function niceStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 25;
  const magnitude = 10 ** Math.floor(Math.log10(span));
  const normalized = span / magnitude;
  if (normalized < 2) return magnitude / 4;
  if (normalized < 5) return magnitude / 2;
  return magnitude;
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const svgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  touchAction: "none",
  userSelect: "none",
};
