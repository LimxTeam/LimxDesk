import { useState } from "react";

/** 单个视图插槽 — 用户可保存/召回视图布局 */
interface ViewSlot {
  /** 槽位编号 */
  id: number;
  /** 用户保存的视图名称（空 = 空槽） */
  name: string;
}

/** 初始化 18 个空插槽（3 列 × 6 行） */
function createSlots(): ViewSlot[] {
  return Array.from({ length: 18 }, (_, i) => ({ id: i + 1, name: "" }));
}

export function RightSidebar() {
  const [slots, setSlots] = useState<ViewSlot[]>(createSlots);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  /** 模拟"保存当前视图到插槽" */
  function handleSaveSlot(slotId: number) {
    const name = window.prompt(`保存视图到 Slot ${slotId}，输入名称：`);
    if (name !== null) {
      setSlots((prev) =>
        prev.map((s) => (s.id === slotId ? { ...s, name: name.trim() || `View ${slotId}` } : s)),
      );
    }
  }

  /** 清空插槽 */
  function handleClearSlot(slotId: number) {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, name: "" } : s)),
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          height: 26,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 6px",
          borderBottom: "1px solid var(--lx-stroke)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--lx-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Views
        </span>
        <span
          style={{
            fontSize: 9,
            color: "var(--lx-fg-muted)",
            fontFamily: "var(--lx-font-mono)",
          }}
        >
          {slots.filter((s) => s.name).length}/18
        </span>
      </div>

      {/* 视图插槽网格 — 1 列，隐藏滚动条 */}
      <div
        className="lx-hide-scrollbar"
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 2,
          padding: 4,
          overflowY: "auto",
          alignContent: "start",
          scrollbarWidth: "none",
        }}
      >
        {slots.map((slot) => {
          const isActive = activeSlot === slot.id;
          const hasSaved = slot.name !== "";

          return (
            <button
              key={slot.id}
              // 左键 = 召回视图，右键 = 保存视图
              onClick={() => {
                if (hasSaved) {
                  setActiveSlot(slot.id);
                } else {
                  handleSaveSlot(slot.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (hasSaved) {
                  handleClearSlot(slot.id);
                } else {
                  handleSaveSlot(slot.id);
                }
              }}
              title={
                hasSaved
                  ? `${slot.name} — 左键切换 | 右键清空`
                  : `Slot ${slot.id} — 点击保存视图`
              }
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                height: 44,
                borderRadius: "var(--lx-radius-sm)",
                background: isActive
                  ? "var(--lx-primary-dim)"
                  : hasSaved
                    ? "var(--lx-bg-surface)"
                    : "var(--lx-bg-deep)",
                border: isActive
                  ? "1px solid var(--lx-primary-trace)"
                  : hasSaved
                    ? "1px solid var(--lx-stroke)"
                    : "1px dashed var(--lx-stroke)",
                cursor: "pointer",
                transition: "all var(--lx-duration-fast)",
                padding: "2px 3px",
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              {/* 编号 */}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "var(--lx-font-mono)",
                  lineHeight: 1,
                  color: isActive
                    ? "var(--lx-primary-bright)"
                    : hasSaved
                      ? "var(--lx-fg-secondary)"
                      : "var(--lx-fg-muted)",
                }}
              >
                {slot.id}
              </span>
              {/* 视图名 */}
              {hasSaved && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 500,
                    lineHeight: 1.1,
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                    color: isActive
                      ? "var(--lx-primary-bright)"
                      : "var(--lx-fg-tertiary)",
                  }}
                >
                  {slot.name}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
