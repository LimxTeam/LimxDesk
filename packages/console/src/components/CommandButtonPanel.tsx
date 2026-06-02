import { useState, useCallback } from "react";

/**
 * 右侧命令/数字按钮面板
 *
 * 布局：
 *  ┌──────────────────┬────────────┬────────────────┐
 *  │ 左侧：功能按钮    │ 中间：数字  │ 右侧：        │
 *  │ [On][Off][Sel]  │ 键盘（4列   │ [Please]      │
 *  │ [Move][Copy]…   │ 严格等宽）  │ [Oops]        │
 *  │                  │            │ [ESC]         │
 *  │                  │            │ [Clear]       │
 *  └──────────────────┴────────────┴────────────────┘
 */

const BTN_HEIGHT = 32;
const BTN_FONT = 13;
const GAP = 3;

/** 功能按钮（每行4个） */
const COMMAND_ROWS = [
  ["On", "Off", "Select", "Fixture"],
  ["Move", "Copy", "Delete", "Stomp"],
  ["Edit", "Update", "", ""],
  ["Group", "Preset", "Sequence", "Cue"],
];

/** 数字键盘：严格 4 列 × 5 行，所有格子等宽 */
const NUMPAD_KEYS = [
  "7",  "8",  "9",  "+",
  "4",  "5",  "6",  "Thru",
  "1",  "2",  "3",  "-",
  "0",  ".",  "If", "At",
  "DESK", "/",  "Please", "",
];

/** 右侧按钮（Store 放最下面） */
const RIGHT_KEYS = ["Oops", "ESC", "Clear", "Store"];

// ─── 样式 ───────────────────────────────

function btnStyle(warn?: boolean, pressed?: boolean): React.CSSProperties {
  const base = warn
    ? "linear-gradient(180deg, #5a2020 0%, #3a1010 100%)"
    : "linear-gradient(180deg, #3c3c44 0%, #2a2a32 100%)";
  const active = warn
    ? "linear-gradient(180deg, #3a1010 0%, #5a2020 100%)"
    : "linear-gradient(180deg, #2a2a32 0%, #3c3c44 100%)";
  return {
    height: BTN_HEIGHT,
    border: "1px solid var(--lx-stroke)",
    borderRadius: "var(--lx-radius-xs)",
    background: pressed ? active : base,
    color: warn ? "#ff9090" : "var(--lx-fg-primary)",
    fontWeight: 600,
    fontSize: BTN_FONT,
    cursor: "pointer",
    userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
    padding: "0 4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.12s, transform 0.12s",
    boxShadow: pressed
      ? "0 0 1px rgba(0,0,0,0.5), inset 0 1px 2px rgba(0,0,0,0.3)"
      : "0 1px 2px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)",
    fontFamily: "inherit",
    transform: pressed ? "translateY(1px)" : undefined,
  };
}

function isOp(key: string) {
  return ["+", "Thru", "-", "At", "/"].includes(key);
}

function isWarn(key: string) {
  return ["Off", "Delete", "Oops", "Clear"].includes(key);
}

// ─── 组件 ─────────────────────────────────

export interface CommandButtonPanelProps {
  onButtonPress?: (label: string) => void;
}

export function CommandButtonPanel({ onButtonPress }: CommandButtonPanelProps) {
  const [pressed, setPressed] = useState<string | null>(null);

  const handlePress = useCallback(
    (label: string) => {
      if (!label) return;
      setPressed(label);
      onButtonPress?.(label);
      setTimeout(() => setPressed(null), 120);
    },
    [onButtonPress],
  );

  const renderBtn = (label: string, styleOverrides?: React.CSSProperties) => {
    if (!label) return <div key={`ph-${Math.random()}`} style={{ visibility: "hidden" }} />;
    const isPlease = label === "Please";
    const warn = isWarn(label);
    const op = isOp(label);
    return (
      <button
        key={label}
        onClick={() => handlePress(label)}
        style={{
          ...btnStyle(warn || op, pressed === label),
          fontFamily: /^[0-9.]$/.test(label)
            ? '"Fira Code", monospace'
            : undefined,
          fontWeight: op ? 700 : isPlease ? 700 : 600,
          fontSize: /^[0-9]$/.test(label) ? BTN_FONT + 1 : BTN_FONT,
          ...(isPlease
            ? {
                background:
                  pressed === "Please"
                    ? "linear-gradient(180deg, #7a5a00 0%, #b07e00 100%)"
                    : "linear-gradient(180deg, #b07e00 0%, #7a5a00 100%)",
                color: "#000",
                letterSpacing: 1,
              }
            : {}),
          ...styleOverrides,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 6,
        height: "100%",
        padding: "4px 6px",
        boxSizing: "border-box",
        flexShrink: 0,
      }}
    >
      {/* 左侧：功能按钮 4列网格 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 68px)",
          gap: GAP,
          flexShrink: 0,
          alignContent: "start",
        }}
      >
        {COMMAND_ROWS.flat().map((label) => renderBtn(label))}
      </div>

      {/* 中间：数字键盘 — 固定 4 列等宽 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 36px)",
          gap: GAP,
          flexShrink: 0,
          alignContent: "start",
        }}
      >
        {NUMPAD_KEYS.map((key) => renderBtn(key))}
      </div>

      {/* 右侧：Oops + ESC + Clear + Store 垂直排列 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: GAP,
          width: 56,
          flexShrink: 0,
        }}
      >
        {RIGHT_KEYS.map((label) => (
          <div key={label} style={{ flex: 1 }}>
            {renderBtn(label)}
          </div>
        ))}
      </div>
    </div>
  );
}
