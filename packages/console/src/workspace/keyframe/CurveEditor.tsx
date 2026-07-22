import { useCallback, useMemo, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  CYCLE_DEGREES,
  makeKeyframe,
  normalizeAngle,
  sample,
  sortKeyframes,
  valueRange,
  type Keyframe,
} from "./curve";

/**
 * 关键帧曲线编辑器。
 *
 * 横轴是一个完整周期的 0..360 度，纵轴是属性值。曲线闭环 —— 右端接回左端，
 * 所以右边缘之外画的是首帧的重复，帮助看清接缝处是否平滑。
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
  keyframes: Keyframe[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onChange: (keyframes: Keyframe[]) => void;
  /** 当前播放角度，没有在跑时为 null。 */
  playhead: number | null;
  disabled?: boolean;
}

export function CurveEditor({
  keyframes,
  selectedIndex,
  onSelect,
  onChange,
  playhead,
  disabled = false,
}: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ index: number } | null>(null);

  // 纵轴范围取整到"整齐"的边界，这样拖动关键帧时坐标轴不会一直跳。
  const range = useMemo(() => niceRange(valueRange(keyframes)), [keyframes]);

  const toX = useCallback((angle: number) => PAD_LEFT + (angle / CYCLE_DEGREES) * PLOT_WIDTH, []);
  const toY = useCallback(
    (value: number) => {
      const span = range.max - range.min || 1;
      return PAD_TOP + PLOT_HEIGHT - ((value - range.min) / span) * PLOT_HEIGHT;
    },
    [range],
  );

  /** 屏幕坐标 → 数据坐标。 */
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

  const path = useMemo(() => buildPath(keyframes, toX, toY), [keyframes, toX, toY]);

  function handleBackgroundClick(event: ReactPointerEvent<SVGRectElement>) {
    if (disabled) return;
    const point = fromClient(event.clientX, event.clientY);
    if (!point) return;

    // 在空白处按下即新增一帧并选中它，可以立刻接着拖。
    const next = sortKeyframes([
      ...keyframes,
      makeKeyframe(clampAngle(point.angle), round(point.value), inheritedInterpolation(keyframes)),
    ]);
    const index = next.findIndex(
      (frame) => Math.abs(frame.angle - clampAngle(point.angle)) < 1e-6,
    );
    onChange(next);
    onSelect(index >= 0 ? index : null);
  }

  function handleKeyframePointerDown(event: ReactPointerEvent<SVGGElement>, index: number) {
    if (disabled) return;
    event.stopPropagation();
    onSelect(index);
    dragRef.current = { index };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    if (!drag || disabled) return;
    const point = fromClient(event.clientX, event.clientY);
    if (!point) return;

    const moved = keyframes.map((frame, index) =>
      index === drag.index
        ? { ...frame, angle: clampAngle(point.angle), value: round(point.value) }
        : frame,
    );

    // 拖过相邻帧时顺序会变，重排后要把选中跟到新位置上，
    // 否则松手前后选中的会是另一帧。
    const target = moved[drag.index];
    const sorted = sortKeyframes(moved);
    const nextIndex = sorted.indexOf(target);
    dragRef.current = { index: nextIndex >= 0 ? nextIndex : drag.index };
    onChange(sorted);
    onSelect(nextIndex >= 0 ? nextIndex : drag.index);
  }

  function handlePointerUp(event: ReactPointerEvent<SVGGElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
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
        onPointerDown={handleBackgroundClick}
        style={{ cursor: disabled ? "default" : "crosshair" }}
      />

      {/* 角度刻度：每 90 度一条，标出四分之一周期 */}
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

      {/* 曲线 */}
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

      {/* 关键帧 */}
      {keyframes.map((frame, index) => {
        const selected = index === selectedIndex;
        return (
          <g
            key={`${frame.angle}-${index}`}
            onPointerDown={(event) => handleKeyframePointerDown(event, index)}
            style={{ cursor: disabled ? "default" : "grab" }}
          >
            {/* 命中区域比可见的点大一圈，拖起来不用瞄准 */}
            <circle cx={toX(frame.angle)} cy={toY(frame.value)} r={11} fill="transparent" />
            <circle
              cx={toX(frame.angle)}
              cy={toY(frame.value)}
              r={selected ? 6 : 4.5}
              fill={selected ? "var(--lx-accent-bright)" : "var(--lx-bg-deep)"}
              stroke="var(--lx-accent-bright)"
              strokeWidth={2}
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
  keyframes: Keyframe[],
  toX: (angle: number) => number,
  toY: (value: number) => number,
): string {
  if (keyframes.length === 0) return "";

  const points: string[] = [];
  for (let angle = 0; angle <= CYCLE_DEGREES; angle += SAMPLE_STEP) {
    // 360 度处取 0 度的值，让曲线首尾接上。
    const value = sample(keyframes, angle >= CYCLE_DEGREES ? 0 : angle);
    points.push(`${points.length === 0 ? "M" : "L"}${toX(angle).toFixed(2)},${toY(value).toFixed(2)}`);
  }
  return points.join(" ");
}

/** 新帧沿用曲线上已有的插值方式，而不是一律回到线性。 */
function inheritedInterpolation(keyframes: Keyframe[]) {
  return keyframes[0]?.interpolation ?? "linear";
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
