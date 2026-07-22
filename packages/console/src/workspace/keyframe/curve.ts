/**
 * 关键帧曲线求值（前端副本）。
 *
 * 这份实现必须与 backend/crates/limxdesk-keyframe/src/curve.rs 保持一致 ——
 * 编辑器要在拖拽过程中实时重绘曲线，走 IPC 采样会毁掉手感，所以这里复刻
 * 一份纯前端的求值。改动任一侧时另一侧要同步。
 *
 * 曲线是环形的：一个周期整整 360 度，末帧接回首帧。
 */

export const CYCLE_DEGREES = 360;

export type Interpolation = "step" | "linear" | "smooth" | "bezier";

export interface Handle {
  /** 段角度跨度的比例 0..1 */
  dx: number;
  /** 段值域的比例，可超出 0..1 做过冲 */
  dy: number;
}

export interface Keyframe {
  angle: number;
  value: number;
  interpolation: Interpolation;
  handleOut: Handle;
  handleIn: Handle;
}

export const DEFAULT_HANDLE: Handle = { dx: 1 / 3, dy: 0 };

export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const wrapped = angle % CYCLE_DEGREES;
  return wrapped < 0 ? wrapped + CYCLE_DEGREES : wrapped;
}

export function makeKeyframe(angle: number, value: number, interpolation: Interpolation = "linear"): Keyframe {
  return {
    angle: normalizeAngle(angle),
    value,
    interpolation,
    handleOut: { ...DEFAULT_HANDLE },
    handleIn: { ...DEFAULT_HANDLE },
  };
}

export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes]
    .map((frame) => ({ ...frame, angle: normalizeAngle(frame.angle) }))
    .sort((left, right) => left.angle - right.angle);
}

/** 在给定角度采样曲线。关键帧须已排序。 */
export function sample(keyframes: Keyframe[], angle: number): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  const target = normalizeAngle(angle);
  const [from, to, progress] = segmentAt(keyframes, target);
  return interpolate(from, to, progress);
}

/**
 * 找出角度所在的段。落在末帧之后或首帧之前时走的是跨 0 度的收尾段 ——
 * 曲线在这里闭合成环。
 */
function segmentAt(keyframes: Keyframe[], angle: number): [Keyframe, Keyframe, number] {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];

  if (angle < first.angle || angle >= last.angle) {
    const span = CYCLE_DEGREES - last.angle + first.angle;
    const travelled = angle >= last.angle ? angle - last.angle : CYCLE_DEGREES - last.angle + angle;
    return [last, first, ratio(travelled, span)];
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (angle >= from.angle && angle < to.angle) {
      return [from, to, ratio(angle - from.angle, to.angle - from.angle)];
    }
  }

  return [last, last, 0];
}

function ratio(travelled: number, span: number): number {
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, travelled / span));
}

function interpolate(from: Keyframe, to: Keyframe, progress: number): number {
  switch (from.interpolation) {
    case "step":
      return from.value;
    case "smooth":
      return lerp(from.value, to.value, smoothstep(progress));
    case "bezier":
      return lerp(from.value, to.value, bezierEase(from.handleOut, to.handleIn, progress));
    default:
      return lerp(from.value, to.value, progress);
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** 与 CSS cubic-bezier 同构的缓动。 */
function bezierEase(outHandle: Handle, inHandle: Handle, x: number): number {
  const clamped = Math.min(1, Math.max(0, x));
  const x1 = Math.min(1, Math.max(0, outHandle.dx));
  const y1 = outHandle.dy;
  const x2 = Math.min(1, Math.max(0, 1 - inHandle.dx));
  const y2 = 1 - inHandle.dy;

  const t = solveBezierT(clamped, x1, x2);
  return cubicBezier(t, y1, y2);
}

function solveBezierT(x: number, x1: number, x2: number): number {
  const EPSILON = 1e-6;

  let t = x;
  for (let index = 0; index < 8; index += 1) {
    const error = cubicBezier(t, x1, x2) - x;
    if (Math.abs(error) < EPSILON) return t;
    const derivative = cubicBezierDerivative(t, x1, x2);
    if (Math.abs(derivative) < EPSILON) break;
    t -= error / derivative;
  }

  // 牛顿法不收敛时退回二分。
  let low = 0;
  let high = 1;
  t = Math.min(1, Math.max(0, x));
  for (let index = 0; index < 32; index += 1) {
    const value = cubicBezier(t, x1, x2);
    if (Math.abs(value - x) < EPSILON) break;
    if (value < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return t;
}

function cubicBezier(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function cubicBezierDerivative(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/** 曲线的取值范围，用来决定绘图的纵轴。留一点余量避免贴边。 */
export function valueRange(keyframes: Keyframe[]): { min: number; max: number } {
  if (keyframes.length === 0) return { min: 0, max: 100 };

  let min = Infinity;
  let max = -Infinity;
  for (const frame of keyframes) {
    min = Math.min(min, frame.value);
    max = Math.max(max, frame.value);
  }
  // 贝塞尔过冲可能超出关键帧本身的范围，采样一遍把它包进去。
  for (let angle = 0; angle < CYCLE_DEGREES; angle += 4) {
    const value = sample(keyframes, angle);
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (min === max) {
    return { min: min - 50, max: max + 50 };
  }
  const padding = (max - min) * 0.12;
  return { min: min - padding, max: max + padding };
}
