import { useState, useCallback } from "react";

/**
 * 带状态循环的工具按钮组
 *
 * - 普通按钮：点击触发 onClick
 * - 带 states 的按钮：点击循环切换状态，下方显示当前状态文字
 *
 * 示例：
 *   Align:   Off → < → > → >< → <> → (循环)
 *   Readout: Natural → Percent → PercentFine → Physical → ... → (循环)
 */

export interface ToolItem {
  id: string;
  /** 按钮文字，支持 \n 换行 */
  label: string;
  /** 状态列表，不传则表示普通按钮（无状态循环） */
  states?: string[];
  /** 默认激活的状态索引 */
  defaultStateIndex?: number;
  /** 是否默认高亮 */
  defaultActive?: boolean;
}

/** 默认工具列表（与 MA3 一致） */
const DEFAULT_TOOLS: ToolItem[] = [
  { id: "single-step", label: "Single\nStep", defaultActive: true },
  {
    id: "align",
    label: "Align",
    states: ["Off", "<", ">", "><", "<>"],
    defaultStateIndex: 0, // 默认 Off
  },
  {
    id: "readout",
    label: "Readout",
    states: [
      "Natural",
      "Percent",
      "PercentFine",
      "Physical",
      "Decimal8",
      "Decimal16",
      "Decimal24",
      "Hex8",
      "Hex16",
      "Hex24",
    ],
    defaultStateIndex: 0, // 默认 Natural
  },
];

interface ToolButtonGroupProps {
  tools?: ToolItem[];
  /** 受控：当前激活的按钮 id */
  activeId?: string;
  /** 受控：各按钮的状态索引 { [toolId]: stateIndex } */
  stateIndices?: Record<string, number>;
  onChange?: (id: string) => void;
  /** 状态变化回调 */
  onStateChange?: (toolId: string, stateIndex: number, stateValue: string) => void;
}

export function ToolButtonGroup({
  tools = DEFAULT_TOOLS,
  activeId: controlledId,
  stateIndices: controlledStates,
  onChange,
  onStateChange,
}: ToolButtonGroupProps) {
  const [internalActive, setInternalActive] = useState("single-step");
  const [internalStates, setInternalStates] = useState<Record<string, number>>({
    align: 0,
    readout: 0,
  });

  const activeId = controlledId ?? internalActive;
  const stateIndices = controlledStates ?? internalStates;

  /** 点击按钮：普通按钮直接激活；带 states 的按钮循环切换状态 */
  const handleClick = useCallback(
    (tool: ToolItem) => {
      if (!tool.states) {
        // 普通按钮：激活
        setInternalActive(tool.id);
        onChange?.(tool.id);
      } else {
        // 状态按钮：循环切换状态
        const nextIndex = ((stateIndices[tool.id] ?? 0) + 1) % tool.states.length;
        setInternalStates((prev) => ({ ...prev, [tool.id]: nextIndex }));
        onStateChange?.(tool.id, nextIndex, tool.states![nextIndex]);
      }
    },
    [stateIndices, onChange, onStateChange]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "2px 2px 2px 4px",
        borderRight: "1px solid var(--lx-stroke)",
        height: "100%",
        justifyContent: "center",
      }}
    >
      {tools.map((tool) => {
        const isActive = activeId === tool.id;
        const currentStateIndex = stateIndices[tool.id] ?? 0;
        const currentState = tool.states?.[currentStateIndex] ?? "";
        const lines = tool.label.split("\n");

        // 按钮背景：激活 or 状态非 Off/Non-Natural
        const hasActiveState =
          tool.states && currentStateIndex > 0;
        const bgActive = isActive || hasActiveState;

        return (
          <button
            key={tool.id}
            onClick={() => handleClick(tool)}
            title={`${tool.label} — ${currentState}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0,
              width: 52,
              minHeight: 32,
              padding: "2px 3px 1px 3px",
              fontSize: 11,
              fontWeight: bgActive ? 700 : 600,
              lineHeight: 1.15,
              textAlign: "center",
              borderRadius: "var(--lx-radius-xs)",
              border: bgActive
                ? "1px solid var(--lx-accent-trace)"
                : "1px solid transparent",
              cursor: "pointer",
              transition: "all var(--lx-duration-fast)",
              background: bgActive
                ? "var(--lx-bg-deep)"
                : "transparent",
              color: bgActive
                ? "var(--lx-fg-primary)"
                : "var(--lx-fg-tertiary)",
              flexShrink: 0,
              boxSizing: "border-box",
            }}
          >
            {/* 主标签 */}
            {lines.map((line, i) => (
              <span key={i} style={{ whiteSpace: "nowrap" }}>
                {line}
              </span>
            ))}

            {/* 状态显示（仅带 states 的按钮） */}
            {tool.states && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  marginTop: 1,
                  padding: "0 3px",
                  borderRadius: "var(--lx-radius-xs)",
                  background:
                    hasActiveState
                      ? "var(--lx-accent-dim)"
                      : "transparent",
                  color: hasActiveState
                    ? "var(--lx-accent-bright)"
                    : "var(--lx-fg-muted)",
                  lineHeight: 1.2,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {currentState}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
