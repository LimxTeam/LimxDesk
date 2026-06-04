import { useCallback, useRef, useState } from "react";
import { getWorkspaceWindowItem } from "./windowCatalog";
import type { GridCell, GridRect, WorkspaceWindow, WorkspaceWindowType } from "./types";

export const WORKSPACE_GRID_COLS = 24;
export const WORKSPACE_GRID_ROWS = 14;

function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return !(
    a.x >= b.x + b.w ||
    a.x + a.w <= b.x ||
    a.y >= b.y + b.h ||
    a.y + a.h <= b.y
  );
}

function clampRectToGrid(rect: GridRect): GridRect {
  const w = Math.max(1, Math.min(rect.w, WORKSPACE_GRID_COLS));
  const h = Math.max(1, Math.min(rect.h, WORKSPACE_GRID_ROWS));
  const x = Math.max(0, Math.min(rect.x, WORKSPACE_GRID_COLS - w));
  const y = Math.max(0, Math.min(rect.y, WORKSPACE_GRID_ROWS - h));
  return { x, y, w, h };
}

function isAreaAvailable(
  windows: WorkspaceWindow[],
  rect: GridRect,
  excludeId?: string,
): boolean {
  const normalized = clampRectToGrid(rect);
  return windows.every((window) => {
    if (window.id === excludeId) return true;
    return !rectsOverlap(window, normalized);
  });
}

function findAvailableRect(
  windows: WorkspaceWindow[],
  anchor: GridCell,
  desired: Pick<GridRect, "w" | "h">,
): GridRect | null {
  const maxW = Math.min(desired.w, WORKSPACE_GRID_COLS - anchor.x);
  const maxH = Math.min(desired.h, WORKSPACE_GRID_ROWS - anchor.y);

  for (let width = maxW; width >= 1; width -= 1) {
    for (let height = maxH; height >= 1; height -= 1) {
      const candidate = { x: anchor.x, y: anchor.y, w: width, h: height };
      if (isAreaAvailable(windows, candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function useWorkspaceLayout() {
  const [windows, setWindows] = useState<WorkspaceWindow[]>([]);
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>(null);
  const [pendingAddCell, setPendingAddCell] = useState<GridCell | null>(null);
  const nextIdRef = useRef(1);

  const requestAddWindowAtCell = useCallback((x: number, y: number) => {
    setPendingAddCell({ x, y });
  }, []);

  const closeAddWindowDialog = useCallback(() => {
    setPendingAddCell(null);
  }, []);

  const addWindow = useCallback(
    (type: WorkspaceWindowType) => {
      if (!pendingAddCell) return;

      const item = getWorkspaceWindowItem(type);

      setWindows((prev) => {
        const rect = findAvailableRect(prev, pendingAddCell, item.defaultSize);
        if (!rect) return prev;

        const id = `window_${nextIdRef.current}`;
        nextIdRef.current += 1;

        return [...prev, { id, type, ...rect }];
      });

      setPendingAddCell(null);
    },
    [pendingAddCell],
  );

  const updateWindowRect = useCallback((windowId: string, nextRect: GridRect) => {
    setWindows((prev) =>
      prev.map((window) => {
        if (window.id !== windowId) return window;
        const normalized = clampRectToGrid(nextRect);
        if (!isAreaAvailable(prev, normalized, windowId)) {
          return window;
        }
        return { ...window, ...normalized };
      }),
    );
  }, []);

  const removeWindow = useCallback((windowId: string) => {
    setWindows((prev) => prev.filter((window) => window.id !== windowId));
    setSelectedWindowId((prev) => (prev === windowId ? null : prev));
  }, []);

  const isCellOccupied = useCallback(
    (x: number, y: number) =>
      windows.some(
        (window) =>
          x >= window.x &&
          x < window.x + window.w &&
          y >= window.y &&
          y < window.y + window.h,
      ),
    [windows],
  );

  return {
    windows,
    selectedWindowId,
    pendingAddCell,
    requestAddWindowAtCell,
    closeAddWindowDialog,
    addWindow,
    updateWindowRect,
    removeWindow,
    selectWindow: setSelectedWindowId,
    isCellOccupied,
  };
}
