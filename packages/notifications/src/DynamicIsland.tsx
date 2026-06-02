import { useSyncExternalStore, useRef, useEffect, useState } from "react";
import { dynamicIsland, type IslandTask, type IslandType } from "./store";
import {
  CheckCircle2,
  Loader2,
  XCircle,
  AlertTriangle,
  Info,
} from "lucide-react";

/**
 * 全局灵动岛单例 — iOS 风格硅胶胶囊
 *
 * - 对角线渐变背景模拟 3D 玻璃折射
 * - 多层 box-shadow 制造深度
 * - glow 参数控制边框呼吸辉光
 * - iOS 弹簧式弹入/弹出动画
 * - 图标内联无背景圆，紧凑高效
 */
export function DynamicIsland() {
  const tasks = useSyncExternalStore(
    dynamicIsland.subscribe,
    dynamicIsland.getSnapshot,
    dynamicIsland.getSnapshot,
  );
  const top = tasks.length > 0 ? tasks[tasks.length - 1] : null;

  // 延迟卸载：先播退出动画再清空
  const [rendered, setRendered] = useState<IslandTask | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (top) {
      clearTimeout(exitTimer.current);
      setRendered(top);
    } else if (rendered) {
      // 无任务 → 延迟 200ms 等退出动画播完再清 DOM
      exitTimer.current = setTimeout(() => setRendered(null), 220);
    }
  }, [top]);

  const visible = rendered !== null;
  const showOverlay = rendered?.overlay === true;

  return (
    <>
      {/* 全屏模糊覆层（仅 overlay=true 时显示） */}
      {showOverlay && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1299,
            background: "rgba(3, 7, 18, 0.50)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? "auto" : "none",
            transition: "opacity 0.35s ease-out",
          }}
        />
      )}

      {/* 灵动岛胶囊 */}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "fixed",
          top: 72,
          left: "50%",
          transform: visible
            ? "translateX(-50%) scale(1)"
            : "translateX(-50%) scale(0.85)",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          zIndex: 1300,
          // 进入：spring 弹性，退出：快速收缩
          transition: visible
            ? "opacity 0.28s ease-out, transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)"
            : "opacity 0.15s ease-in, transform 0.22s cubic-bezier(0.36, 0, 0.66, -0.56)",
        }}
      >
        {rendered && <IslandCapsule task={rendered} />}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════
// 颜色工具
// ═══════════════════════════════════════════════

function colorToRgba(cssVar: string, alpha: number): string {
  const map: Record<string, string> = {
    "var(--lx-action-bright)": "120, 217, 120",
    "var(--lx-primary-bright)": "77, 163, 245",
    "var(--lx-accent-bright)": "245, 184, 77",
    "var(--lx-status-error)": "231, 72, 86",
  };
  return `rgba(${map[cssVar] ?? "120, 217, 120"}, ${alpha})`;
}

function rimColor(cssVar: string): string {
  const map: Record<string, string> = {
    "var(--lx-action-bright)": "rgba(120, 217, 120, 0.22)",
    "var(--lx-primary-bright)": "rgba(77, 163, 245, 0.22)",
    "var(--lx-accent-bright)": "rgba(245, 184, 77, 0.22)",
    "var(--lx-status-error)": "rgba(231, 72, 86, 0.22)",
  };
  return map[cssVar] ?? "rgba(120, 217, 120, 0.22)";
}

// ═══════════════════════════════════════════════
// 类型预设
// ═══════════════════════════════════════════════

interface TypePreset {
  icon: ReturnType<typeof CheckCircle2>;
  color: string;
  glow: boolean;
  spinning: boolean;
}

function resolveType(type?: IslandType): TypePreset {
  switch (type) {
    case "success":
      return { icon: <CheckCircle2 size={16} />, color: "var(--lx-action-bright)", glow: false, spinning: false };
    case "loading":
      return { icon: <Loader2 size={16} />, color: "var(--lx-primary-bright)", glow: true, spinning: true };
    case "error":
      return { icon: <XCircle size={16} />, color: "var(--lx-status-error)", glow: false, spinning: false };
    case "warning":
      return { icon: <AlertTriangle size={16} />, color: "var(--lx-accent-bright)", glow: false, spinning: false };
    case "info":
      return { icon: <Info size={16} />, color: "var(--lx-primary-bright)", glow: false, spinning: false };
    default:
      return { icon: undefined as never, color: "var(--lx-action-bright)", glow: false, spinning: false };
  }
}

// ═══════════════════════════════════════════════
// 胶囊本体
// ═══════════════════════════════════════════════

function IslandCapsule({ task }: { task: IslandTask }) {
  const resolved = resolveType(task.type);
  const color = task.color ?? resolved.color;
  const icon = task.icon ?? resolved.icon;
  const glow = task.glow ?? resolved.glow;
  const spinning = task.spinning ?? resolved.spinning;
  const hasIcon = icon !== undefined;

  const hasProgress = typeof task.progress === "number" && Number.isFinite(task.progress);
  const progressPct = hasProgress ? Math.max(0, Math.min(1, task.progress as number)) * 100 : 0;

  return (
    <div
      className={glow ? "lx-island-capsule lx-island-glow" : "lx-island-capsule"}
      onClick={task.onClick}
      style={{
        minWidth: 280,
        maxWidth: 500,
        height: 50,
        borderRadius: 25,
        background: "linear-gradient(135deg, #0B1120 60%, #1E293B)",
        border: `1px solid ${rimColor(color)}`,
        boxShadow: `
          0 4px 24px rgba(0, 0, 0, 0.55),
          0 0 0 1px ${colorToRgba(color, 0.06)},
          0 0 18px ${colorToRgba(color, 0.04)}
        `,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 16px",
        position: "relative",
        overflow: "hidden",
        cursor: task.onClick ? "pointer" : undefined,
      }}
    >
      {/* 图标（内联，无背景圆） */}
      {hasIcon && (
        <span
          style={{
            display: "inline-flex",
            flexShrink: 0,
            color,
            animation: spinning ? "lx-spin 1.1s linear infinite" : undefined,
          }}
        >
          {icon}
        </span>
      )}

      {/* 标题 + 副标题 */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--lx-fg-primary)",
            lineHeight: "18px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {task.title}
        </span>
        {task.subtitle && (
          <span
            style={{
              fontSize: 11,
              color: "var(--lx-fg-tertiary)",
              lineHeight: "15px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {task.subtitle}
          </span>
        )}
      </div>

      {/* 底部进度条 */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, overflow: "hidden" }}>
        {hasProgress ? (
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: color,
              boxShadow: `0 0 6px ${color}`,
              transition: "width 200ms ease-out",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `linear-gradient(90deg, transparent, ${color}, var(--lx-accent-bright), transparent)`,
              animation: "lx-island-sweep 1.8s ease-in-out infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}
