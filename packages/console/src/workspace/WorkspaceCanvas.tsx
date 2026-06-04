import { useEffect, useMemo, useRef, useState } from "react";
import { AddWindowDialog } from "./AddWindowDialog";
import { GridWindowFrame } from "./GridWindowFrame";
import {
  useWorkspaceLayout,
  WORKSPACE_GRID_COLS,
  WORKSPACE_GRID_ROWS,
} from "./useWorkspaceLayout";
import type { GridCell, GridRect, WorkspaceWindow } from "./types";

const CELL_GAP = 2;

interface ActiveDrag {
  mode: "move" | "resize";
  windowId: string;
  startPointer: {
    x: number;
    y: number;
  };
  startRect: GridRect;
}

function clampCell(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export function WorkspaceCanvas() {
  const {
    windows,
    selectedWindowId,
    pendingAddCell,
    requestAddWindowAtCell,
    closeAddWindowDialog,
    addWindow,
    updateWindowRect,
    removeWindow,
    selectWindow,
    isCellOccupied,
  } = useWorkspaceLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const windowMap = useMemo(
    () =>
      new Map<string, WorkspaceWindow>(
        windows.map((window) => [window.id, window]),
      ),
    [windows],
  );

  const cellWidth = containerSize.width / WORKSPACE_GRID_COLS || 0;
  const cellHeight = containerSize.height / WORKSPACE_GRID_ROWS || 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) return;
      setContainerSize({ width: next.width, height: next.height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeDrag || !cellWidth || !cellHeight) return;
    const drag = activeDrag;

    function handlePointerMove(event: PointerEvent) {
      const deltaX = Math.round((event.clientX - drag.startPointer.x) / cellWidth);
      const deltaY = Math.round((event.clientY - drag.startPointer.y) / cellHeight);

      if (drag.mode === "move") {
        updateWindowRect(drag.windowId, {
          ...drag.startRect,
          x: clampCell(
            drag.startRect.x + deltaX,
            WORKSPACE_GRID_COLS - drag.startRect.w,
          ),
          y: clampCell(
            drag.startRect.y + deltaY,
            WORKSPACE_GRID_ROWS - drag.startRect.h,
          ),
        });
      } else {
        updateWindowRect(drag.windowId, {
          ...drag.startRect,
          w: Math.max(1, drag.startRect.w + deltaX),
          h: Math.max(1, drag.startRect.h + deltaY),
        });
      }
    }

    function handlePointerUp() {
      setActiveDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeDrag, cellHeight, cellWidth, updateWindowRect]);

  function getCellFromPointer(
    event: React.PointerEvent<HTMLDivElement>,
  ): GridCell | null {
    const element = containerRef.current;
    if (!element || !cellWidth || !cellHeight) return null;

    const rect = element.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;

    return {
      x: clampCell(Math.floor(localX / cellWidth), WORKSPACE_GRID_COLS - 1),
      y: clampCell(Math.floor(localY / cellHeight), WORKSPACE_GRID_ROWS - 1),
    };
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    const cell = getCellFromPointer(event);
    if (!cell) return;

    selectWindow(null);
    if (!isCellOccupied(cell.x, cell.y)) {
      requestAddWindowAtCell(cell.x, cell.y);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (activeDrag || event.target !== event.currentTarget) return;

    const cell = getCellFromPointer(event);
    setHoverCell(cell);
  }

  function beginDrag(
    mode: ActiveDrag["mode"],
    windowId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const targetWindow = windowMap.get(windowId);
    if (!targetWindow) return;

    event.preventDefault();
    selectWindow(windowId);
    setActiveDrag({
      mode,
      windowId,
      startPointer: { x: event.clientX, y: event.clientY },
      startRect: {
        x: targetWindow.x,
        y: targetWindow.y,
        w: targetWindow.w,
        h: targetWindow.h,
      },
    });
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerLeave={() => setHoverCell(null)}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top, rgba(77, 163, 245, 0.06), transparent 26%), var(--lx-bg-void)",
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
        `,
        backgroundSize: `${cellWidth || 40}px ${cellHeight || 40}px`,
      }}
    >
      {hoverCell && !isCellOccupied(hoverCell.x, hoverCell.y) && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: hoverCell.x * cellWidth + CELL_GAP / 2,
            top: hoverCell.y * cellHeight + CELL_GAP / 2,
            width: Math.max(0, cellWidth - CELL_GAP),
            height: Math.max(0, cellHeight - CELL_GAP),
            background: "rgba(77, 163, 245, 0.16)",
            border: "1px solid rgba(77, 163, 245, 0.34)",
            pointerEvents: "none",
          }}
        />
      )}

      {windows.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "18px 20px",
              borderRadius: 12,
              border: "1px solid rgba(255, 255, 255, 0.06)",
              background: "rgba(17, 19, 26, 0.78)",
              color: "var(--lx-fg-tertiary)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            点击网格空白区域添加窗口
          </div>
        </div>
      )}

      {windows.map((window) => (
        <GridWindowFrame
          key={window.id}
          window={window}
          selected={selectedWindowId === window.id}
          left={window.x * cellWidth + CELL_GAP / 2}
          top={window.y * cellHeight + CELL_GAP / 2}
          width={window.w * cellWidth - CELL_GAP}
          height={window.h * cellHeight - CELL_GAP}
          onSelect={selectWindow}
          onMoveStart={(windowId, event) => beginDrag("move", windowId, event)}
          onResizeStart={(windowId, event) =>
            beginDrag("resize", windowId, event)
          }
          onRemove={removeWindow}
        />
      ))}

      <AddWindowDialog
        cell={pendingAddCell}
        onClose={closeAddWindowDialog}
        onSelect={addWindow}
      />
    </div>
  );
}
