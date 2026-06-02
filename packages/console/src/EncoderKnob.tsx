interface EncoderKnobProps {
  label: string;
  value?: string;
}

export function EncoderKnob({ label, value }: EncoderKnobProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
      }}
    >
      {/* 旋钮 */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--lx-bg-elevated), var(--lx-bg-surface))",
          border: "2px solid var(--lx-stroke-strong)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "grab",
          position: "relative",
        }}
      >
        {/* 旋钮指示线 */}
        <div
          style={{
            position: "absolute",
            top: 5,
            left: "50%",
            width: 2,
            height: 8,
            background: "var(--lx-primary-bright)",
            borderRadius: 1,
            transform: "translateX(-50%) rotate(-30deg)",
          }}
        />
      </div>
      <span style={{ fontSize: 9, color: "var(--lx-fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      {value !== undefined && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--lx-font-mono)",
            fontWeight: 600,
            color: "var(--lx-primary-bright)",
          }}
        >
          {value}
        </span>
      )}
    </div>
  );
}
