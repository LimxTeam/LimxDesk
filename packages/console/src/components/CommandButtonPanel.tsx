import { useCallback, useState } from "react";
import { useCommandRuntimeSnapshot, type DeskCommandMode, type DeskCommandTarget } from "../command/commandRuntime";

const KEY_HEIGHT = 32;
const GAP = 4;

type KeyTone = "neutral" | "positive" | "danger" | "operator" | "execute";

type KeyDef = {
  label: string;
  tone?: KeyTone;
  span?: number;
};

const COMMAND_KEYS: KeyDef[] = [
  { label: "On", tone: "positive", span: 3 },
  { label: "Off", tone: "danger", span: 3 },
  { label: "Select", span: 3 },
  { label: "Fixture", span: 3 },
  { label: "Move", span: 3 },
  { label: "Copy", span: 3 },
  { label: "Delete", tone: "danger", span: 3 },
  { label: "Stomp", span: 3 },
  { label: "Sequence", span: 3 },
  { label: "Cue", span: 3 },
  { label: "Group", span: 3 },
  { label: "Preset", span: 3 },
  { label: "ESC", span: 4 },
  { label: "Undo", tone: "danger", span: 2 },
  { label: "Redo", tone: "danger", span: 2 },
  { label: "Clear", tone: "danger", span: 4 },
  { label: "Store", span: 4 },
  { label: "Update", span: 4 },
  { label: "Edit", span: 4 },
];

const NUMPAD_KEYS: KeyDef[] = [
  { label: "7" },
  { label: "8" },
  { label: "9" },
  { label: "+", tone: "operator" },
  { label: "4" },
  { label: "5" },
  { label: "6" },
  { label: "Thru", tone: "operator" },
  { label: "1" },
  { label: "2" },
  { label: "3" },
  { label: "-", tone: "operator" },
  { label: "0" },
  { label: "." },
  { label: "If", tone: "operator" },
  { label: "At", tone: "operator" },
  { label: "DESK" },
  { label: "/", tone: "operator" },
  { label: "Please", tone: "execute", span: 2 },
];

const toneStyle: Record<KeyTone, React.CSSProperties> = {
  neutral: {
    background:
      "linear-gradient(180deg, rgba(86, 88, 99, 0.96) 0%, rgba(50, 52, 60, 0.98) 48%, rgba(31, 32, 38, 1) 100%)",
    borderColor: "rgba(208, 213, 224, 0.13)",
    color: "#F1F3F7",
  },
  positive: {
    background:
      "linear-gradient(180deg, rgba(72, 105, 92, 0.96) 0%, rgba(45, 68, 62, 0.98) 50%, rgba(29, 43, 41, 1) 100%)",
    borderColor: "rgba(124, 207, 176, 0.25)",
    color: "#D9FFF0",
  },
  danger: {
    background:
      "linear-gradient(180deg, rgba(116, 67, 73, 0.96) 0%, rgba(78, 39, 46, 0.98) 50%, rgba(49, 24, 30, 1) 100%)",
    borderColor: "rgba(238, 126, 138, 0.27)",
    color: "#FFD7DB",
  },
  operator: {
    background:
      "linear-gradient(180deg, rgba(92, 83, 66, 0.96) 0%, rgba(62, 54, 45, 0.98) 50%, rgba(38, 35, 32, 1) 100%)",
    borderColor: "rgba(230, 178, 96, 0.26)",
    color: "#F6D39A",
  },
  execute: {
    background:
      "linear-gradient(180deg, rgba(235, 193, 73, 0.98) 0%, rgba(202, 151, 30, 0.99) 52%, rgba(133, 92, 13, 1) 100%)",
    borderColor: "rgba(255, 223, 128, 0.48)",
    color: "#18130A",
  },
};

function getPressedStyle(tone: KeyTone): React.CSSProperties {
  if (tone === "execute") {
    return {
      background:
        "linear-gradient(180deg, rgba(180, 124, 17, 1) 0%, rgba(226, 178, 55, 0.98) 100%)",
      boxShadow:
        "inset 0 2px 7px rgba(46, 31, 4, 0.42), inset 0 -1px 0 rgba(255, 236, 165, 0.16)",
    };
  }

  return {
    filter: "brightness(0.92) saturate(0.96)",
    boxShadow:
      "inset 0 2px 7px rgba(0, 0, 0, 0.46), inset 0 -1px 0 rgba(255, 255, 255, 0.05)",
  };
}

function keyStyle(key: KeyDef, isPressed: boolean, isActive: boolean): React.CSSProperties {
  const tone = key.tone ?? "neutral";
  const numeric = /^[0-9.]$/.test(key.label);
  const depth = isPressed
    ? getPressedStyle(tone).boxShadow
    : "inset 0 1px 1px rgba(255, 255, 255, 0.14), inset 0 -7px 13px rgba(0, 0, 0, 0.22), 0 2px 4px rgba(0, 0, 0, 0.38)";

  const style: React.CSSProperties = {
    ...toneStyle[tone],
    ...(isPressed ? getPressedStyle(tone) : {}),
    minWidth: 0,
    height: KEY_HEIGHT,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "var(--lx-radius-md)",
    padding: key.label.length > 7 ? "0 5px" : "0 8px",
    color: toneStyle[tone].color,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: numeric ? "var(--lx-font-mono)" : "inherit",
    fontSize: numeric ? 13 : 12,
    fontWeight: tone === "execute" || tone === "operator" ? 800 : 700,
    lineHeight: 1,
    textShadow:
      tone === "execute"
        ? "0 1px 0 rgba(255, 236, 166, 0.20)"
        : "0 1px 1px rgba(0, 0, 0, 0.48)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    userSelect: "none",
    transform: isPressed ? "translateY(1px)" : "translateY(0)",
    boxShadow: depth,
    transition:
      "transform var(--lx-duration-instant) var(--lx-ease-out), filter var(--lx-duration-instant) var(--lx-ease-out), box-shadow var(--lx-duration-instant) var(--lx-ease-out), border-color var(--lx-duration-fast) var(--lx-ease-out)",
  };

  if (!isActive) return style;
  return {
    ...style,
    borderColor: "rgba(245, 184, 77, 0.78)",
    color: tone === "execute" ? "#18130A" : "#FFD76A",
    boxShadow:
      "inset 0 1px 1px rgba(255, 255, 255, 0.14), inset 0 -7px 13px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(245, 184, 77, 0.34)",
  };
}

function keyGridStyle(columns: string): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: columns,
    gridAutoRows: KEY_HEIGHT,
    gap: GAP,
    alignContent: "start",
    minWidth: 0,
  };
}

export interface CommandButtonPanelProps {
  onButtonPress?: (label: string) => void;
}

export function CommandButtonPanel({ onButtonPress }: CommandButtonPanelProps) {
  const [pressed, setPressed] = useState<string | null>(null);
  const commandState = useCommandRuntimeSnapshot();

  const handlePress = useCallback(
    (label: string) => {
      setPressed(label);
      onButtonPress?.(label);
      window.setTimeout(() => setPressed(null), 120);
    },
    [onButtonPress],
  );

  const renderKey = (key: KeyDef) => (
    <button
      key={key.label}
      onClick={() => handlePress(key.label)}
      disabled={key.label === "Undo" ? commandState.undoCount === 0 : key.label === "Redo" ? commandState.redoCount === 0 : false}
      style={{
        ...keyStyle(key, pressed === key.label, isKeyActive(key.label, commandState.mode, commandState.target, commandState.tokens)),
        opacity:
          (key.label === "Undo" && commandState.undoCount === 0) ||
          (key.label === "Redo" && commandState.redoCount === 0)
            ? 0.48
            : undefined,
        cursor:
          (key.label === "Undo" && commandState.undoCount === 0) ||
          (key.label === "Redo" && commandState.redoCount === 0)
            ? "not-allowed"
            : "pointer",
        gridColumn: key.span ? `span ${key.span}` : undefined,
      }}
    >
      {key.label}
    </button>
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px 200px",
        gap: 8,
        width: 522,
        height: "100%",
        padding: 0,
        boxSizing: "border-box",
        flexShrink: 0,
        alignItems: "end",
      }}
    >
      <div style={{ height: 182, minWidth: 0 }}>
        <div style={keyGridStyle("repeat(12, minmax(0, 1fr))")}>
          {COMMAND_KEYS.map(renderKey)}
        </div>
      </div>

      <div style={{ height: 182, minWidth: 0 }}>
        <div style={keyGridStyle("repeat(4, minmax(0, 1fr))")}>
          {NUMPAD_KEYS.map(renderKey)}
        </div>
      </div>
    </div>
  );
}

function isKeyActive(label: string, mode: DeskCommandMode, target: DeskCommandTarget | null, tokens: string[]) {
  const modeByLabel: Partial<Record<string, DeskCommandMode>> = {
    Store: "store",
    Update: "update",
    Edit: "edit",
    Delete: "delete",
    Copy: "copy",
    Move: "move",
    Select: "select",
    On: "on",
    Off: "off",
    Stomp: "stomp",
  };
  const targetByLabel: Partial<Record<string, DeskCommandTarget>> = {
    Fixture: "fixture",
    Group: "group",
    Preset: "preset",
    Sequence: "sequence",
    Cue: "cue",
    DESK: "executor",
  };
  const tokenLabels = new Set(["Thru", "+", "-", "If", "At", "/", "."]);
  return modeByLabel[label] === mode || targetByLabel[label] === target || (tokenLabels.has(label) && tokens.includes(label));
}
