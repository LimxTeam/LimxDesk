import { useState, useCallback } from "react";

/* ── 按钮定义 ── */

const COMMAND_BTNS = [
  "On", "Off", "Move", "Copy", "Delete",
  "Stomp", "Select", "Goto", "Help", "Align",
];

const OBJECT_BTNS = [
  "Fixture", "Channel", "Group",
  "Preset", "Sequence", "Cue",
  "Edit", "Assign", "Time",
  "Update", "Store",
];

const NUMPAD_ROWS = [
  ["7", "8", "9", "+"],
  ["4", "5", "6", "Thru"],
  ["1", "2", "3", "-"],
  ["0", ".", "If", "At"],
  ["MA", "/"],
];

const AUX_BTNS = [
  { label: "Oops", warn: true },
  { label: "ESC", warn: false },
  { label: "Clear", warn: true },
];

/* 固定尺寸 */
const BTN_H = 28;          // 普通按钮高度
const BTN_GAP = 4;         // 按钮间距
const PAD_X = 6;           // 面板水平内边距
const PAD_Y = 5;           // 面板垂直内边距
const SECTION_GAP = 5;     // 区域间距

/* ── 组件 ── */

interface CommandButtonPanelProps {
  onButtonPress?: (label: string) => void;
}

export function CommandButtonPanel({ onButtonPress }: CommandButtonPanelProps) {
  const [pressed, setPressed] = useState<string | null>(null);

  const handlePress = useCallback(
    (label: string) => {
      setPressed(label);
      onButtonPress?.(label);
      setTimeout(() => setPressed(null), 120);
    },
    [onButtonPress]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: SECTION_GAP,
        padding: `${PAD_Y}px ${PAD_X}px`,
        flexShrink: 0,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* ── 命令按钮（5列 × 2行）── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: `${BTN_GAP}px`,
          height: BTN_H * 2 + BTN_GAP,
          flexShrink: 0,
        }}
      >
        {COMMAND_BTNS.map((label) => (
          <ConsoleButton
            key={label}
            label={label}
            pressed={pressed === label}
            onPress={() => handlePress(label)}
          />
        ))}
      </div>

      {/* ── 主体：对象按钮 + 数字键盘 + 辅助按钮 ── */}
      <div
        style={{
          display: "flex",
          gap: BTN_GAP + 2,
          height: BTN_H * 5 + BTN_GAP * 4,
          flexShrink: 0,
        }}
      >
        {/* 左侧：对象按钮（3列 × 4行） */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridTemplateRows: `repeat(4, ${BTN_H}px)`,
            gap: `${BTN_GAP}px`,
            width: 170,
            flexShrink: 0,
          }}
        >
          {OBJECT_BTNS.slice(0, 9).map((label) => (
            <ConsoleButton
              key={label}
              label={label}
              pressed={pressed === label}
              onPress={() => handlePress(label)}
              small
            />
          ))}
          <div style={{ gridColumn: "span 2" }}>
            <ConsoleButton
              label="Update"
              pressed={pressed === "Update"}
              onPress={() => handlePress("Update")}
              small
            />
          </div>
          <ConsoleButton
            label="Store"
            pressed={pressed === "Store"}
            onPress={() => handlePress("Store")}
            small
          />
        </div>

        {/* 中间：数字键盘（4列 × 5行） */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gridTemplateRows: `repeat(5, ${BTN_H}px)`,
            gap: `${BTN_GAP}px`,
            flex: 1,
            minWidth: 0,
          }}
        >
          {NUMPAD_ROWS.map((row, ri) =>
            row.map((label, ci) => {
              const isWide = label === "MA";
              return (
                <div
                  key={`${ri}-${ci}`}
                  style={isWide ? { gridColumn: "span 2" } : undefined}
                >
                  <ConsoleButton
                    label={label}
                    pressed={pressed === label}
                    onPress={() => handlePress(label)}
                    small
                    mono={!isNaN(Number(label)) || label === "."}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* 右侧：辅助按钮（垂直分布） */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: BTN_GAP,
            width: 65,
            flexShrink: 0,
          }}
        >
          {AUX_BTNS.map((btn) => (
            <ConsoleButton
              key={btn.label}
              label={btn.label}
              pressed={pressed === btn.label}
              onPress={() => handlePress(btn.label)}
              warn={btn.warn}
              small
            />
          ))}
        </div>
      </div>

      {/* ── 底部：Please 按钮 ── */}
      <div style={{ height: BTN_H + 4, flexShrink: 0 }}>
        <ConsoleButton
          label="Please"
          pressed={pressed === "Please"}
          onPress={() => handlePress("Please")}
          highlight
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── */

interface ConsoleButtonProps {
  label: string;
  pressed?: boolean;
  onPress: () => void;
  highlight?: boolean;
  warn?: boolean;
  small?: boolean;
  mono?: boolean;
}

function ConsoleButton({
  label,
  pressed,
  onPress,
  highlight,
  warn,
  small,
  mono,
}: ConsoleButtonProps) {
  const isPressed = pressed;

  const bg = highlight
    ? isPressed
      ? "#c47a00"
      : "#b87400"
    : warn
    ? isPressed
      ? "#8a1c1c"
      : "#6e1717"
    : isPressed
    ? "#2a2a30"
    : "#32323a";

  const borderColor = highlight
    ? "rgba(255,180,40,0.35)"
    : warn
    ? "rgba(220,60,60,0.3)"
    : "rgba(255,255,255,0.08)";

  const textColor = highlight
    ? "#fff"
    : warn
    ? "#ff8888"
    : "var(--lx-fg-primary, #ddd)";

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "var(--lx-radius-xs, 3px)",
        border: `1px solid ${borderColor}`,
        background: bg,
        color: textColor,
        fontSize: small ? 11 : 12,
        fontWeight: mono ? 700 : 600,
        fontFamily: mono
          ? '"SF Mono", "Fira Code", "JetBrains Mono", monospace'
          : "inherit",
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.05s, transform 0.05s",
        transform: isPressed ? "translateY(1px)" : "none",
        letterSpacing: "0.02em",
        padding: "0 4px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: 1,
      }}
    >
      {label}
    </button>
  );
}
