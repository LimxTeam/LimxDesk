import { useState } from "react";

export interface AttributeTab {
  id: string;
  label: string;
  number?: number;
  /** 特殊高亮色 */
  highlight?: "amber" | "green" | null;
}

const DEFAULT_TABS: AttributeTab[] = [
  { id: "dimmer",    label: "Dimmer",    number: 1 },
  { id: "position",  label: "Position",  number: 2 },
  { id: "gobo",      label: "Gobo",      number: 3 },
  { id: "color",     label: "Color",     number: 4 },
  { id: "beam",      label: "Beam",      number: 5 },
  { id: "focus",     label: "Focus",     number: 6 },
  { id: "selection", label: "Selection" },
  { id: "phaser",    label: "Phaser" },
  { id: "matricks",  label: "MAtricks" },
  { id: "progtime",  label: "Prog Time" },
  { id: "exectime",  label: "Exec Time" },
];

interface AttributeTabBarProps {
  tabs?: AttributeTab[];
  activeId?: string;
  onChange?: (id: string) => void;
}

export function AttributeTabBar({
  tabs = DEFAULT_TABS,
  activeId: controlledId,
  onChange,
}: AttributeTabBarProps) {
  const [internalActive, setInternalActive] = useState("dimmer");
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
        height: 26,
        padding: "0 4px",
        gap: 1,
        borderBottom: "1px solid var(--lx-stroke)",
        flexShrink: 0,
        overflowX: "auto",
      }}
      className="lx-hide-scrollbar"
    >
      {tabs.map((tab) => {
        const isActive = activeId === tab.id;
        const isHighlighted = tab.highlight === "amber";

        return (
          <button
            key={tab.id}
            onClick={() => handleClick(tab.id)}
            style={{
              height: 20,
              padding: "0 8px",
              fontSize: 12,
              fontWeight: isActive ? 700 : 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              borderRadius: "var(--lx-radius-xs)",
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "all var(--lx-duration-fast)",
              background: isActive
                ? isHighlighted
                  ? "rgba(240, 157, 28, 0.18)"
                  : "var(--lx-accent-dim)"
                : "transparent",
              color: isActive
                ? isHighlighted
                  ? "var(--lx-accent-bright)"
                  : "var(--lx-accent-bright)"
                : isHighlighted
                  ? "var(--lx-accent-bright)"
                  : "var(--lx-fg-tertiary)",
            }}
          >
            {tab.number !== undefined ? `${tab.number} ${tab.label}` : tab.label}
          </button>
        );
      })}
    </div>
  );
}
