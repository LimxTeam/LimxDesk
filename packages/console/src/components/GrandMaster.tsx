interface GrandMasterProps {
  value?: number;
  label?: string;
}

export function GrandMaster({
  value = 100,
  label = "Grand Master",
}: GrandMasterProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        padding: "0 6px",
      }}
    >
      {/* 标签 */}
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: "var(--lx-fg-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      {/* 推子轨道 */}
      <div
        style={{
          position: "relative",
          width: 32,
          height: 56,
          background: "var(--lx-bg-deep)",
          border: "1px solid var(--lx-stroke-strong)",
          borderRadius: "var(--lx-radius-sm)",
          overflow: "hidden",
        }}
      >
        {/* 填充条（从下往上） */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${clamped}%`,
            background:
              clamped > 80
                ? "linear-gradient(to top, var(--lx-action-dim), rgba(78,201,78,0.15))"
                : clamped > 50
                  ? "linear-gradient(to top, var(--lx-accent-dim), rgba(240,157,28,0.15))"
                  : "linear-gradient(to top, rgba(231,72,86,0.12), rgba(231,72,86,0.05))",
            transition: "height 0.15s ease-out",
          }}
        />

        {/* 推子手柄 */}
        <div
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            bottom: `calc(${clamped}% - 6px)`,
            height: 12,
            background:
              "linear-gradient(180deg, var(--lx-bg-elevated), var(--lx-bg-hover))",
            border: "1px solid var(--lx-stroke-strong)",
            borderRadius: "var(--lx-radius-xs)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            transition: "bottom 0.15s ease-out",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* 手柄上的刻度线 */}
          <div
            style={{
              width: 10,
              height: 1,
              background: "var(--lx-fg-muted)",
              borderRadius: 1,
            }}
          />
        </div>

        {/* 刻度标记 */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <div
            key={tick}
            style={{
              position: "absolute",
              left: 2,
              right: 2,
              bottom: `${tick}%`,
              height: 1,
              background:
                tick === 0 || tick === 100
                  ? "var(--lx-stroke-strong)"
                  : "var(--lx-stroke)",
              opacity: 0.6,
            }}
          />
        ))}
      </div>

      {/* 数值 */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "var(--lx-font-mono)",
          color:
            clamped > 80
              ? "var(--lx-action-bright)"
              : clamped > 50
                ? "var(--lx-accent-bright)"
                : "var(--lx-status-error)",
        }}
      >
        {clamped}%
      </span>
    </div>
  );
}
