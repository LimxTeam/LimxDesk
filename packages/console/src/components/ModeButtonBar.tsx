import { useState } from "react";

export interface ModeButton {
  id: string;
  label: string;
  /** 是否默认黄色高亮 */
  defaultHighlight?: boolean;
}

const LEFT_MODES: ModeButton[] = [
  { id: "values",    label: "Values and\nTimings", defaultHighlight: true },
  { id: "overall",   label: "Phaser\nOverall" },
  { id: "steps",     label: "Phaser\nSteps" },
];

const RIGHT_MODES: ModeButton[] = [
  { id: "absolute",  label: "Absolute" },
  { id: "relative",  label: "Relative" },
  { id: "fade",      label: "Fade" },
  { id: "delay",     label: "Delay" },
];

interface ModeButtonBarProps {
  leftModes?: ModeButton[];
  rightModes?: ModeButton[];
  activeId?: string;
  onChange?: (id: string) => void;
}

function ModeBtn({
  btn,
  isActive,
  onClick,
}: {
  btn: ModeButton;
  isActive: boolean;
  onClick: () => void;
}) {
  const lines = btn.label.split("\n");
  const isHighlighted = btn.defaultHighlight && isActive;

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        minWidth: 58,
        height: 36,
        padding: "0 7px",
        fontSize: 9,
        fontWeight: isActive ? 600 : 500,
        lineHeight: 1.2,
        textAlign: "center",
        borderRadius: "var(--lx-radius-xs)",
        border: isActive
          ? isHighlighted
            ? "1px solid var(--lx-accent-trace)"
            : "1px solid var(--lx-stroke-strong)"
          : "1px solid transparent",
        cursor: "pointer",
        transition: "all var(--lx-duration-fast)",
        background: isActive
          ? isHighlighted
            ? "var(--lx-accent-dim)"
            : "var(--lx-bg-deep)"
          : "transparent",
        color: isActive
          ? isHighlighted
            ? "var(--lx-accent-bright)"
            : "var(--lx-fg-primary)"
          : "var(--lx-fg-tertiary)",
        flexShrink: 0,
      }}
    >
      {lines.map((line, i) => (
        <span key={i} style={{ whiteSpace: "nowrap" }}>
          {line}
        </span>
      ))}
    </button>
  );
}

export function ModeButtonBar({
  leftModes = LEFT_MODES,
  rightModes = RIGHT_MODES,
  activeId: controlledId,
  onChange,
}: ModeButtonBarProps) {
  const [internalActive, setInternalActive] = useState("values");
  const activeId = controlledId ?? internalActive;

  function handleClick(id: string) {
    setInternalActive(id);
    onChange?.(id);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        height: "100%",
      }}
    >
      {/* 左侧模式组 */}
      <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
        {leftModes.map((btn) => (
          <ModeBtn
            key={btn.id}
            btn={btn}
            isActive={activeId === btn.id}
            onClick={() => handleClick(btn.id)}
          />
        ))}
      </div>

      {/* 分隔线 */}
      <div
        style={{
          width: 1,
          height: 28,
          background: "var(--lx-stroke)",
          margin: "0 4px",
          flexShrink: 0,
        }}
      />

      {/* 右侧模式组 */}
      <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
        {rightModes.map((btn) => (
          <ModeBtn
            key={btn.id}
            btn={btn}
            isActive={activeId === btn.id}
            onClick={() => handleClick(btn.id)}
          />
        ))}
      </div>
    </div>
  );
}
