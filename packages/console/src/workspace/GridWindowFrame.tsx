import { WindowSurface } from "./WindowSurface";
import { getWorkspaceWindowItem } from "./windowCatalog";
import type { WorkspaceWindow } from "./types";

export interface GridWindowFrameProps {
  window: WorkspaceWindow;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  onSelect: (windowId: string) => void;
  onMoveStart: (windowId: string, event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (windowId: string, event: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: (windowId: string) => void;
}

export function GridWindowFrame({
  window,
  left,
  top,
  width,
  height,
  selected,
  onSelect,
  onMoveStart,
  onResizeStart,
  onRemove,
}: GridWindowFrameProps) {
  const item = getWorkspaceWindowItem(window.type);

  return (
    <div
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(window.id);
      }}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        overflow: "hidden",
        borderRadius: 8,
        border: selected
          ? `1px solid ${item.accent}`
          : "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(27, 29, 36, 0.98)",
        boxShadow: selected
          ? `0 0 0 1px ${item.accent} inset, 0 12px 26px rgba(0, 0, 0, 0.26)`
          : "0 12px 26px rgba(0, 0, 0, 0.24)",
      }}
    >
      <div
        onPointerDown={(event) => {
          event.stopPropagation();
          onMoveStart(window.id, event);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 28,
          padding: "0 6px 0 4px",
          background: "linear-gradient(180deg, rgba(42, 42, 46, 1), rgba(34, 34, 39, 1))",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          cursor: "grab",
        }}
      >
        <div
          style={{
            width: 46,
            height: 18,
            borderRadius: "var(--lx-radius-xs)",
            background: item.accent,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.06em",
          }}
        >
          {item.icon}
          <span style={{ fontSize: 7 }}>▼</span>
        </div>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--lx-fg-secondary)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </span>

        <button
          type="button"
          title="移除窗口"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={() => onRemove(window.id)}
          style={{
            width: 20,
            height: 20,
            border: "1px solid rgba(231, 72, 86, 0.24)",
            borderRadius: "var(--lx-radius-xs)",
            background: "rgba(81, 18, 24, 0.7)",
            color: "#FFD4D9",
            fontSize: 11,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ height: `calc(100% - 28px)` }}>
        <WindowSurface window={window} />
      </div>

      <div
        onPointerDown={(event) => {
          event.stopPropagation();
          onResizeStart(window.id, event);
        }}
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255, 255, 255, 0.22)",
          cursor: "nwse-resize",
          userSelect: "none",
        }}
      >
        ◢
      </div>
    </div>
  );
}
