import { useEffect } from "react";
import { WORKSPACE_WINDOW_CATALOG } from "./windowCatalog";
import type { GridCell, WorkspaceWindowType } from "./types";

export interface AddWindowDialogProps {
  cell: GridCell | null;
  onClose: () => void;
  onSelect: (type: WorkspaceWindowType) => void;
}

export function AddWindowDialog({
  cell,
  onClose,
  onSelect,
}: AddWindowDialogProps) {
  useEffect(() => {
    if (!cell) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cell, onClose]);

  if (!cell) return null;

  return (
    <div
      onPointerDown={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.48)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "calc(100% - 32px)",
          border: "1px solid var(--lx-stroke-strong)",
          borderRadius: "var(--lx-radius-lg)",
          overflow: "hidden",
          background: "var(--lx-bg-surface)",
          boxShadow: "var(--lx-shadow-xl)",
        }}
      >
        <div
          style={{
            height: 32,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--lx-bg-elevated)",
            borderBottom: "1px solid var(--lx-stroke)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--lx-fg-primary)" }}>
            添加窗口
          </span>
          <span style={{ fontSize: 10, color: "var(--lx-fg-tertiary)" }}>
            Grid {cell.x + 1}, {cell.y + 1}
          </span>
        </div>

        <div
          style={{
            padding: 12,
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {WORKSPACE_WINDOW_CATALOG.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => onSelect(item.type)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minHeight: 58,
                padding: "10px 12px",
                borderRadius: "var(--lx-radius-sm)",
                border: "1px solid var(--lx-stroke-strong)",
                borderLeft: `3px solid ${item.accent}`,
                background: "var(--lx-bg-deep)",
                color: "var(--lx-fg-primary)",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 24,
                  color: item.accent,
                  fontSize: 12,
                  fontWeight: 800,
                  textAlign: "center",
                }}
              >
                {item.icon}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{item.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
