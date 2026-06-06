import {
  createDefaultNamedAppearance,
  normalizeNamedAppearance,
  type NamedAppearance,
} from "@limxdesk/naming";
import type { WorkspaceWindow } from "./types";

export const VIEW_SLOT_COUNT = 18;

export interface LayoutDocument {
  windows: LayoutWindow[];
  viewSlots: LayoutViewSlot[];
}

export interface LayoutWindow {
  id: string;
  windowType: WorkspaceWindow["type"];
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

export interface LayoutViewSlot {
  id: number;
  appearance: NamedAppearance;
  windows: LayoutWindow[];
  updatedAtMs: number;
}

export interface ViewSlotModel {
  id: number;
  appearance: NamedAppearance;
  windows: LayoutWindow[];
  updatedAtMs: number;
  saved: boolean;
}

export function createViewSlotModels(slots: LayoutViewSlot[] = []): ViewSlotModel[] {
  const byId = new Map(slots.map((slot) => [slot.id, normalizeViewSlot(slot)]));
  return Array.from({ length: VIEW_SLOT_COUNT }, (_, index) => {
    const id = index + 1;
    const saved = byId.get(id);
    if (saved) {
      return {
        ...saved,
        saved: true,
      };
    }
    return {
      id,
      appearance: createDefaultNamedAppearance(""),
      windows: [],
      updatedAtMs: 0,
      saved: false,
    };
  });
}

export function normalizeViewSlot(slot: LayoutViewSlot): LayoutViewSlot {
  return {
    id: clampSlotId(slot.id),
    appearance: normalizeNamedAppearance(slot.appearance, `View ${clampSlotId(slot.id)}`),
    windows: slot.windows.map(layoutWindowToWorkspaceWindow).map(workspaceWindowToLayoutWindow),
    updatedAtMs: Math.max(0, Math.floor(slot.updatedAtMs || 0)),
  };
}

export function layoutWindowToWorkspaceWindow(window: LayoutWindow): WorkspaceWindow {
  return {
    id: window.id,
    type: window.windowType,
    x: window.x,
    y: window.y,
    w: window.w,
    h: window.h,
    config: sanitizeTransientWindowConfig(window.config ?? {}),
  };
}

export function workspaceWindowToLayoutWindow(window: WorkspaceWindow): LayoutWindow {
  return {
    id: window.id,
    windowType: window.type,
    x: window.x,
    y: window.y,
    w: window.w,
    h: window.h,
    config: sanitizeTransientWindowConfig(window.config ?? {}),
  };
}

function sanitizeTransientWindowConfig(config: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "groupEditorId" || key === "presetEditorId" || key === "presetEditorCategory") continue;
    result[key] = value;
  }
  return result;
}

function clampSlotId(id: number): number {
  if (!Number.isFinite(id)) return 1;
  return Math.min(VIEW_SLOT_COUNT, Math.max(1, Math.floor(id)));
}
