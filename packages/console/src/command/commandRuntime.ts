import { useSyncExternalStore } from "react";

export type DeskCommandMode =
  | "idle"
  | "store"
  | "update"
  | "edit"
  | "delete"
  | "copy"
  | "move"
  | "select"
  | "on"
  | "off"
  | "stomp";

export type DeskCommandTarget = "fixture" | "group" | "preset" | "sequence" | "cue" | "executor";

export interface DeskCommandSource {
  pool: "group" | "preset" | "executor";
  id: number | string;
  category?: string;
  label: string;
}

export interface DeskCommandState {
  mode: DeskCommandMode;
  target: DeskCommandTarget | null;
  source: DeskCommandSource | null;
  tokens: string[];
  status: string;
  undoCount: number;
  redoCount: number;
  lastAction: string | null;
  version: number;
}

export interface DeskHistoryEntry {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const listeners = new Set<() => void>();
const undoStack: DeskHistoryEntry[] = [];
const redoStack: DeskHistoryEntry[] = [];

let state: DeskCommandState = {
  mode: "idle",
  target: null,
  source: null,
  tokens: [],
  status: "Ready",
  undoCount: 0,
  redoCount: 0,
  lastAction: null,
  version: 0,
};

export function subscribeCommandRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCommandRuntimeSnapshot() {
  return state;
}

export function useCommandRuntimeSnapshot() {
  return useSyncExternalStore(subscribeCommandRuntime, getCommandRuntimeSnapshot, getCommandRuntimeSnapshot);
}

export function activateCommandMode(mode: DeskCommandMode, status?: string) {
  setCommandState({
    mode,
    source: null,
    status: status ?? commandModeStatus(mode),
  });
}

export function setCommandTarget(target: DeskCommandTarget | null) {
  setCommandState({
    target,
    status: target ? `${target.toUpperCase()} target selected` : commandModeStatus(state.mode),
  });
}

export function setCommandSource(source: DeskCommandSource | null) {
  setCommandState({
    source,
    status: source ? `${state.mode.toUpperCase()} source: ${source.label}` : commandModeStatus(state.mode),
  });
}

export function appendCommandToken(token: string) {
  setCommandState({
    tokens: [...state.tokens, token],
    status: [...state.tokens, token].join(" "),
  });
}

export function clearCommandEntry(status = "Ready") {
  setCommandState({
    mode: "idle",
    target: null,
    source: null,
    tokens: [],
    status,
  });
}

export function pushCommandHistory(entry: DeskHistoryEntry) {
  undoStack.push(entry);
  redoStack.length = 0;
  setCommandState({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    lastAction: entry.label,
    status: entry.label,
  });
}

export async function undoLastCommand() {
  const entry = undoStack.pop();
  if (!entry) {
    setCommandState({ status: "Nothing to undo", undoCount: 0, redoCount: redoStack.length });
    return;
  }

  await entry.undo();
  redoStack.push(entry);
  clearCommandEntry(`Undo: ${entry.label}`);
  setCommandState({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    lastAction: `Undo ${entry.label}`,
  });
}

export async function redoLastCommand() {
  const entry = redoStack.pop();
  if (!entry) {
    setCommandState({ status: "Nothing to redo", undoCount: undoStack.length, redoCount: 0 });
    return;
  }

  await entry.redo();
  undoStack.push(entry);
  clearCommandEntry(`Redo: ${entry.label}`);
  setCommandState({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    lastAction: `Redo ${entry.label}`,
  });
}

export function isCommandModeActive(mode: DeskCommandMode) {
  return state.mode === mode;
}

function setCommandState(patch: Partial<DeskCommandState>) {
  state = {
    ...state,
    ...patch,
    version: state.version + 1,
  };
  listeners.forEach((listener) => listener());
}

function commandModeStatus(mode: DeskCommandMode) {
  if (mode === "idle") return "Ready";
  if (mode === "store") return "Store: choose a target slot";
  if (mode === "update") return "Update: choose an existing object";
  if (mode === "edit") return "Edit: choose an object";
  if (mode === "delete") return "Delete: choose an object";
  if (mode === "copy") return "Copy: choose source, then destination";
  if (mode === "move") return "Move: choose source, then destination";
  if (mode === "select") return "Select: choose fixtures or objects";
  return `${mode.toUpperCase()} command armed`;
}
