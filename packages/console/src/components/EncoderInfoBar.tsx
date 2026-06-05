import { useState, useCallback } from "react";

/**
 * 编码器上方信息栏
 *
 * 对应 MA3 编码器区域顶部的一行：
 *   [属性名 翻页 如 "Dimmer 1 of 1"]  [Link Resolution]  [Single | Feature]  [模式按钮...]
 *
 * - 属性名 + 翻页：如 "Dimmer 1 of 1"（属性分类 + 当前页/总页）
 * - "Link Resolution" 作为固定标签
 * - Single/Feature 为模式切换按钮
 */

interface EncoderInfoBarProps {
  /** 属性分类名称，如 "Dimmer" */
  attributeName?: string;
  /** 翻页信息，如 "1 of 1" */
  page?: string;
  /** 当前属性是否存在多页可翻 */
  canPage?: boolean;
  /** 当前属性页是否包含已激活 programmer 值 */
  active?: boolean;
  /** 点击属性名时翻页 */
  onAttributeClick?: () => void;
  /** 受控：当前模式 "single" | "feature" */
  mode?: "single" | "feature";
  onModeChange?: (mode: "single" | "feature") => void;
}

export function EncoderInfoBar({
  attributeName = "Dimmer",
  page = "1 of 1",
  canPage = false,
  active = false,
  onAttributeClick,
  mode: controlledMode,
  onModeChange,
}: EncoderInfoBarProps) {
  const [internalMode, setInternalMode] = useState<"single" | "feature">("single");
  const mode = controlledMode ?? internalMode;

  const toggleMode = useCallback(() => {
    const next = mode === "single" ? "feature" : "single";
    setInternalMode(next);
    onModeChange?.(next);
  }, [mode, onModeChange]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        padding: "2px 6px",
        height: 20,
        minHeight: 20,
        flexShrink: 0,
      }}
    >
      {/* 属性名 + 翻页 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        <button
          type="button"
          onClick={canPage ? onAttributeClick : undefined}
          aria-disabled={!canPage}
          title={canPage ? "点击切换下一页属性" : undefined}
          style={{
            padding: 0,
            border: "none",
            background: "transparent",
            fontSize: 12,
            fontWeight: 700,
            color: active
              ? "var(--lx-action-bright)"
              : canPage
                ? "var(--lx-accent-bright)"
                : "var(--lx-fg-secondary)",
            whiteSpace: "nowrap",
            cursor: canPage ? "pointer" : "default",
            lineHeight: 1,
            textDecoration: canPage ? "underline" : "none",
            textUnderlineOffset: "2px",
            textDecorationColor: canPage ? "var(--lx-stroke-accent)" : "transparent",
            opacity: canPage ? 1 : 0.92,
          }}
        >
          {attributeName}
        </button>

        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--lx-fg-secondary)",
            whiteSpace: "nowrap",
          }}
        >
          {page}
        </span>
      </div>

      {/* Link Resolution 标签 */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--lx-fg-muted)",
          whiteSpace: "nowrap",
          userSelect: "none",
        }}
      >
        Link Resolution
      </span>

      {/* Single / Feature 模式切换 */}
      <button
        onClick={toggleMode}
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: "0 8px",
          height: 18,
          borderRadius: "var(--lx-radius-xs)",
          border: "1px solid var(--lx-stroke)",
          background:
            mode === "single"
              ? "var(--lx-bg-deep)"
              : "transparent",
          color:
            mode === "single"
              ? "var(--lx-fg-primary)"
              : "var(--lx-fg-muted)",
          cursor: "pointer",
          transition: "all var(--lx-duration-fast)",
          whiteSpace: "nowrap",
          lineHeight: 1,
        }}
      >
        {mode === "single" ? "Single" : "Feature"}
      </button>
    </div>
  );
}
