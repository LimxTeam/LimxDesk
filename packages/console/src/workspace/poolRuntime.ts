import { createDefaultNamedAppearance, normalizeNamedAppearance, type NamedAppearance } from "@limxdesk/naming";
import { getWorkspaceWindowItem } from "./windowCatalog";
import type { WorkspaceWindow, WorkspaceWindowType } from "./types";

export const GROUP_SLOT_COUNT = 255;
export const PRESET_SLOT_COUNT = 120;

export type PresetCategoryId =
  | "all"
  | "dimmer"
  | "position"
  | "gobo"
  | "color"
  | "beam"
  | "focus"
  | "shapers"
  | "control";

export interface FixtureSelection {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

export interface Programmer {
  live: ProgrammerBuffer;
  preview: ProgrammerBuffer;
  mode: "live" | "preview";
  blind: boolean;
  version: number;
}

export interface ProgrammerBuffer {
  selectedPartId: number;
  parts: ProgrammerPart[];
}

export interface ProgrammerPart {
  id: number;
  label: string | null;
  values: ProgrammerValue[];
}

export interface ProgrammerValue {
  fixtureId: string;
  attribute: string;
  featureGroup: string;
  layer: "absolute" | "relative" | "fade" | "delay";
  value: {
    numeric: number | null;
    text: string | null;
  };
  active: boolean;
  source: "manual" | "preset" | "output";
}

export interface GroupSlot {
  id: number;
  appearance: NamedAppearance;
  fixtureIds: string[];
  primaryFixtureId: string | null;
}

export interface PresetSlot {
  id: number;
  appearance: NamedAppearance;
  values: ProgrammerValue[];
  category: PresetCategoryId;
}

const GRID_COLS = 24;
const GRID_ROWS = 14;
const EPHEMERAL_CONFIG_KEYS = new Set(["groupEditorId", "presetEditorId", "presetEditorCategory"]);

export type WorkspacePoolWindowType = Extract<WorkspaceWindowType, "groups" | "presets" | "sequence-pool">;

export function ensurePoolWindow(windows: WorkspaceWindow[], type: WorkspacePoolWindowType) {
  const existing = windows.find((window) => window.type === type);
  if (existing) {
    return { windows, window: existing };
  }

  const item = getWorkspaceWindowItem(type);
  const rect = findAvailableRect(windows, item.defaultSize.w, item.defaultSize.h) ?? {
    x: 0,
    y: 0,
    w: item.defaultSize.w,
    h: item.defaultSize.h,
  };
  const window: WorkspaceWindow = {
    id: `pool-${type}`,
    type,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    config: {},
  };

  return {
    windows: [...windows, window],
    window,
  };
}

export function replaceWindowConfig(windows: WorkspaceWindow[], windowId: string, config: Record<string, unknown>) {
  return windows.map((window) =>
    window.id === windowId ? { ...window, config: sanitizeWindowConfig(config) } : window,
  );
}

export function sanitizeWindowConfig(config: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (EPHEMERAL_CONFIG_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

export function upsertById<T extends { id: number }>(slots: T[], slot: T) {
  return [...slots.filter((item) => item.id !== slot.id), slot].sort((left, right) => left.id - right.id);
}

export function upsertPreset(slots: PresetSlot[], slot: PresetSlot) {
  return [
    ...slots.filter((item) => !(item.id === slot.id && item.category === slot.category)),
    slot,
  ].sort((left, right) => left.category.localeCompare(right.category) || left.id - right.id);
}

export function normalizeGroupSlots(value: unknown): GroupSlot[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map<GroupSlot | null>((item) => {
      const record = asRecord(item);
      const id = clampInt(record.id, 1, GROUP_SLOT_COUNT);
      const fixtureIds = Array.isArray(record.fixtureIds) ? record.fixtureIds.filter((id): id is string => typeof id === "string") : [];
      if (fixtureIds.length === 0) return null;
      return {
        id,
        fixtureIds,
        primaryFixtureId: typeof record.primaryFixtureId === "string" ? record.primaryFixtureId : fixtureIds[0] ?? null,
        appearance: normalizeNamedAppearance(record.appearance as Partial<NamedAppearance>, `Group ${id}`),
      };
    })
    .filter((item): item is GroupSlot => Boolean(item));
}

export function normalizePresetSlots(value: unknown): PresetSlot[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      const record = asRecord(item);
      const id = clampInt(record.id, 1, PRESET_SLOT_COUNT);
      const category = isPresetCategory(record.category) ? record.category : "all";
      const values = Array.isArray(record.values) ? (record.values as ProgrammerValue[]).filter((value) => value.active) : [];
      if (values.length === 0) return null;
      return {
        id,
        category,
        values,
        appearance: normalizeNamedAppearance(record.appearance as Partial<NamedAppearance>, `${presetCategoryLabel(category)} ${id}`),
      };
    })
    .filter((item): item is PresetSlot => Boolean(item));
}

export function activeProgrammerValues(programmer: Programmer) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  return buffer.parts.flatMap((part) => part.values).filter((value) => value.active);
}

export function storeGroupSlot(slots: GroupSlot[], id: number, selection: FixtureSelection) {
  if (selection.fixtureIds.length === 0) return null;
  const existing = slots.find((slot) => slot.id === id);
  const slot: GroupSlot = {
    id,
    appearance: normalizeNamedAppearance(existing?.appearance, `Group ${id}`),
    fixtureIds: selection.fixtureIds,
    primaryFixtureId: selection.primaryFixtureId,
  };
  return upsertById(slots, slot);
}

export function deleteGroupSlot(slots: GroupSlot[], id: number) {
  return slots.filter((slot) => slot.id !== id);
}

export function copyOrMoveGroupSlot(slots: GroupSlot[], sourceId: number, targetId: number, mode: "copy" | "move") {
  const source = slots.find((slot) => slot.id === sourceId);
  if (!source) return null;
  const nextSlot: GroupSlot = {
    ...source,
    id: targetId,
    appearance: normalizeNamedAppearance(source.appearance, `Group ${targetId}`),
  };
  const withoutTarget = slots.filter((slot) => slot.id !== targetId);
  const base = mode === "move" ? withoutTarget.filter((slot) => slot.id !== sourceId) : withoutTarget;
  return upsertById(base, nextSlot);
}

export function storePresetSlot(slots: PresetSlot[], id: number, category: PresetCategoryId, values: ProgrammerValue[]) {
  const activeValues = values.filter((value) => value.active);
  if (activeValues.length === 0) return null;
  const existing = slots.find((slot) => slot.id === id && slot.category === category);
  const slot: PresetSlot = {
    id,
    category,
    values: activeValues,
    appearance: normalizeNamedAppearance(existing?.appearance, `${presetCategoryLabel(category)} ${id}`),
  };
  return upsertPreset(slots, slot);
}

export function deletePresetSlot(slots: PresetSlot[], id: number, category: PresetCategoryId) {
  return slots.filter((slot) => !(slot.id === id && slot.category === category));
}

export function copyOrMovePresetSlot(
  slots: PresetSlot[],
  sourceId: number,
  targetId: number,
  category: PresetCategoryId,
  mode: "copy" | "move",
) {
  const source = slots.find((slot) => slot.id === sourceId && slot.category === category);
  if (!source) return null;
  const nextSlot: PresetSlot = {
    ...source,
    id: targetId,
    appearance: normalizeNamedAppearance(source.appearance, `${presetCategoryLabel(category)} ${targetId}`),
  };
  const withoutTarget = slots.filter((slot) => !(slot.id === targetId && slot.category === category));
  const base = mode === "move" ? withoutTarget.filter((slot) => !(slot.id === sourceId && slot.category === category)) : withoutTarget;
  return upsertPreset(base, nextSlot);
}

export function presetCategoryLabel(category: PresetCategoryId) {
  if (category === "all") return "All";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function createEmptyGroupSlot(id: number) {
  return {
    id,
    appearance: createDefaultNamedAppearance(`Group ${id}`),
    fixtureIds: [],
    primaryFixtureId: null,
  } satisfies GroupSlot;
}

export function createEmptyPresetSlot(id: number, category: PresetCategoryId) {
  return {
    id,
    category,
    appearance: createDefaultNamedAppearance(`${presetCategoryLabel(category)} ${id}`),
    values: [],
  } satisfies PresetSlot;
}

function findAvailableRect(windows: WorkspaceWindow[], desiredW: number, desiredH: number) {
  const width = Math.max(1, Math.min(desiredW, GRID_COLS));
  const height = Math.max(1, Math.min(desiredH, GRID_ROWS));
  for (let y = 0; y <= GRID_ROWS - height; y += 1) {
    for (let x = 0; x <= GRID_COLS - width; x += 1) {
      const candidate = { x, y, w: width, h: height };
      if (windows.every((window) => !rectsOverlap(window, candidate))) {
        return candidate;
      }
    }
  }
  return null;
}

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return !(
    a.x >= b.x + b.w ||
    a.x + a.w <= b.x ||
    a.y >= b.y + b.h ||
    a.y + a.h <= b.y
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clampInt(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.round(Math.min(max, Math.max(min, number)));
}

function isPresetCategory(value: unknown): value is PresetCategoryId {
  return (
    value === "all" ||
    value === "dimmer" ||
    value === "position" ||
    value === "gobo" ||
    value === "color" ||
    value === "beam" ||
    value === "focus" ||
    value === "shapers" ||
    value === "control"
  );
}
