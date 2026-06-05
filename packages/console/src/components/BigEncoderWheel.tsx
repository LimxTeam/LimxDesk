import { useMemo, useRef, useCallback, useState, useEffect } from "react";

interface BigEncoderWheelProps {
  /** 中心显示的参数名，如 "Dim" */
  paramName?: string;
  /** 编码器下方显示的值，如 "100%" */
  value?: string;
  /** 旋转角度（受控，度） */
  rotation?: number;
  /** 旋转角度变化回调 */
  onRotationChange?: (deg: number) => void;
  /** 编码器增量回调。正数为顺时针，负数为逆时针。 */
  onRotationDelta?: (delta: number) => void;
  /** 当前属性是否在 programmer 中激活 */
  active?: boolean;
  /** 编码器直径（px） */
  size?: number;
}

export function BigEncoderWheel({
  paramName = "Dim",
  value = "100%",
  rotation: controlledRotation,
  onRotationChange,
  onRotationDelta,
  active = false,
  size = 144,
}: BigEncoderWheelProps) {
  const [internalRotation, setInternalRotation] = useState(-30);
  const rotation = controlledRotation ?? internalRotation;

  const dragging = useRef(false);
  const lastPointerAngle = useRef(0);
  const liveRotation = useRef(rotation);
  const frame = useRef<number | null>(null);
  const pendingRotation = useRef(rotation);
  const pendingDelta = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const ticks = useMemo(() => {
    const arr: { angle: number; long: boolean }[] = [];
    for (let i = 0; i < 96; i++) {
      arr.push({ angle: (i / 96) * 360, long: i % 8 === 0 });
    }
    return arr;
  }, []);

  const center = size / 2;
  const outerR = size / 2 - 2;
  const tickStart = outerR - 1;
  const tickEndLong = outerR - 6;
  const tickEndShort = outerR - 3;

  useEffect(() => {
    liveRotation.current = rotation;
    pendingRotation.current = rotation;
  }, [rotation]);

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  function getPointerAngle(e: PointerEvent | React.PointerEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;

    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  function getShortestAngleDelta(next: number, prev: number) {
    return ((next - prev + 540) % 360) - 180;
  }

  /** 更新旋转角度 */
  const updateRotation = useCallback(
    (next: number) => {
      const previous = liveRotation.current;
      const delta = next - previous;
      liveRotation.current = next;
      pendingRotation.current = next;
      pendingDelta.current += delta;

      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        const committedRotation = pendingRotation.current;
        const committedDelta = pendingDelta.current;
        pendingDelta.current = 0;
        setInternalRotation(committedRotation);
        onRotationChange?.(committedRotation);
        if (Math.abs(committedDelta) > 0.0001) {
          onRotationDelta?.(committedDelta);
        }
        frame.current = null;
      });
    },
    [onRotationChange, onRotationDelta]
  );

  /** 指针按下：开始拖动 */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      lastPointerAngle.current = getPointerAngle(e);
      liveRotation.current = rotation;
      e.currentTarget.style.cursor = "grabbing";

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture can fail if the pointer is already released.
      }
    },
    [rotation]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      e.preventDefault();

      const nextAngle = getPointerAngle(e);
      const delta = getShortestAngleDelta(nextAngle, lastPointerAngle.current);
      lastPointerAngle.current = nextAngle;
      updateRotation(liveRotation.current + delta);
    },
    [updateRotation]
  );

  const stopDragging = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.style.cursor = "grab";

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, []);

  /** 鼠标滚轮：悬停时转动 */
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      // deltaY < 0：往上滚 → 反转（逆时针）；deltaY > 0：往下滚 → 正转（顺时针）
      const delta = e.deltaY * 1.2;
      updateRotation(liveRotation.current + delta);
    },
    [updateRotation]
  );

  // 刻度 SVG
  const tickSvg = (
    <svg
      width={size}
      height={size}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: "center",
        pointerEvents: "none",
      }}
    >
      {ticks.map((tick, i) => {
        const rad = ((tick.angle - 90) * Math.PI) / 180;
        const r1 = tick.long ? tickEndLong : tickEndShort;
        const r2 = tickStart;
        const x1 = center + r1 * Math.cos(rad);
        const y1 = center + r1 * Math.sin(rad);
        const x2 = center + r2 * Math.cos(rad);
        const y2 = center + r2 * Math.sin(rad);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={tick.long ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.2)"}
            strokeWidth={tick.long ? 1.5 : 0.7}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );

  // 高光圆弧
  const highlightSvg = (
    <svg
      width={size}
      height={size}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    >
      {/* 顶部长弧形高光 */}
      <path
        d={`
          M ${center - outerR * 0.65} ${center - outerR * 0.38}
          Q ${center} ${center - outerR * 0.58}
            ${center + outerR * 0.65} ${center - outerR * 0.38}
        `}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={1.5}
      />
      {/* 顶部边缘细高光 */}
      <ellipse
        cx={center}
        cy={center}
        rx={outerR * 0.92}
        ry={outerR * 0.92}
        fill="none"
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={0.5}
        strokeDasharray={`${outerR * 1.2} ${outerR * 3.8}`}
        transform={`rotate(-110 ${center} ${center})`}
      />
    </svg>
  );

  return (
    <div
      ref={containerRef}
      data-encoder-wheel
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        cursor: "grab",
        userSelect: "none",
        touchAction: "none",
        // 硅胶质感：多层渐变，无阴影
        background: `
          radial-gradient(ellipse at 35% 30%, rgba(120,120,130,0.25) 0%, transparent 60%),
          radial-gradient(ellipse at 65% 70%, rgba(30,30,35,0.4) 0%, transparent 60%),
          linear-gradient(160deg, #3a3a40 0%, #28282e 40%, #1e1e24 100%)
        `,
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: active ? "0 0 0 1px rgba(120,217,120,0.55), 0 0 18px rgba(120,217,120,0.18)" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onWheel={onWheel}
    >
      {/* ── 外圈刻度环（硅胶按压感）── */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          right: 10,
          bottom: 10,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.035)",
          background: `
            radial-gradient(ellipse at 40% 35%, rgba(90,90,100,0.15) 0%, transparent 50%),
            linear-gradient(155deg, #32323a 0%, #252530 50%, #1c1c22 100%)
          `,
        }}
      />

      {/* ── 刻度线（旋转层）── */}
      {tickSvg}

      {/* ── 高光弧线 ── */}
      {highlightSvg}

      {/* ── 中心圆盘（硅胶按压质感）── */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: size - 24,
          height: size - 24,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `
            radial-gradient(ellipse at 38% 35%, rgba(100,100,110,0.2) 0%, transparent 55%),
            radial-gradient(ellipse at 60% 65%, rgba(20,20,25,0.35) 0%, transparent 50%),
            linear-gradient(155deg, #353540 0%, #282830 40%, #1e1e26 100%)
          `,
          border: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          pointerEvents: "none",
        }}
      >
        {/* 内圈凹陷高光 */}
        <div
          style={{
            position: "absolute",
            top: "18%",
            left: "28%",
            width: "44%",
            height: "30%",
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* 参数名 */}
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: active ? "var(--lx-action-bright)" : "#ccc",
            letterSpacing: "0.04em",
            textShadow: "0 1px 4px rgba(0,0,0,0.7)",
            lineHeight: 1,
            position: "relative",
            zIndex: 1,
          }}
        >
          {paramName}
        </span>

        {/* 参数值 */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: active ? "var(--lx-fg-primary)" : "#777",
            letterSpacing: "0.02em",
            lineHeight: 1,
            position: "relative",
            zIndex: 1,
          }}
        >
          {value}
        </span>
      </div>

      {/* ── 顶部指示器（固定，不随刻度旋转）── */}
      <div
        style={{
          position: "absolute",
          top: 7,
          left: "50%",
          transform: "translateX(-50%)",
          width: 4,
          height: 8,
          background:
            "linear-gradient(180deg, var(--lx-primary-right, #4da6ff) 0%, var(--lx-primary-dim, #1a5faa) 100%)",
          borderRadius: 2,
          zIndex: 2,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
