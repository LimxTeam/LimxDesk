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
  executing: boolean;
  version: number;
}

export interface DeskHistoryEntry {
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

export interface DeskCommandHandlerResult {
  handled: boolean;
  keepCommand?: boolean;
  status?: string;
}

export type DeskCommandHandler = (
  state: DeskCommandState,
) => boolean | DeskCommandHandlerResult | Promise<boolean | DeskCommandHandlerResult>;

const listeners = new Set<() => void>();
const commandHandlers = new Map<string, DeskCommandHandler>();
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
  executing: false,
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

export function registerCommandHandler(id: string, handler: DeskCommandHandler) {
  commandHandlers.set(id, handler);
  return () => {
    if (commandHandlers.get(id) === handler) {
      commandHandlers.delete(id);
    }
  };
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
  const nextTokens = appendSmartToken(state.tokens, token);
  setCommandState({
    tokens: nextTokens,
    status: commandLineText({ ...state, tokens: nextTokens }),
  });
}

export function cancelCommandStep() {
  if (state.source) {
    setCommandState({ source: null, status: commandModeStatus(state.mode) });
    return;
  }

  if (state.tokens.length > 0) {
    const tokens = state.tokens.slice(0, -1);
    setCommandState({ tokens, status: tokens.length > 0 ? commandLineText({ ...state, tokens }) : commandModeStatus(state.mode) });
    return;
  }

  if (state.target) {
    setCommandState({ target: null, status: commandModeStatus(state.mode) });
    return;
  }

  clearCommandEntry();
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

export function setCommandStatus(status: string) {
  setCommandState({ status });
}

export async function executeCurrentCommand() {
  const snapshot = state;
  if (snapshot.executing) return;
  if (snapshot.mode === "idle" && !snapshot.target && snapshot.tokens.length === 0) {
    setCommandState({ status: "No command entered" });
    return;
  }

  setCommandState({ executing: true, status: `Executing: ${commandLineText(snapshot)}` });
  try {
    for (const handler of commandHandlers.values()) {
      const result = normalizeHandlerResult(await handler(snapshot));
      if (result.handled) {
        if (result.keepCommand) {
          setCommandState({ status: result.status ?? state.status });
        } else {
          clearCommandEntry(result.status ?? `Executed: ${commandLineText(snapshot)}`);
        }
        return;
      }
    }
    setCommandState({ status: `No handler: ${commandLineText(snapshot)}` });
  } catch (error) {
    setCommandState({ status: String(error) });
  } finally {
    setCommandState({ executing: false });
  }
}

function normalizeHandlerResult(value: boolean | DeskCommandHandlerResult): DeskCommandHandlerResult {
  return typeof value === "boolean" ? { handled: value } : value;
}

export async function submitCommandText(text: string) {
  const parsed = parseCommandText(text);
  setCommandState(parsed);
  await executeCurrentCommand();
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

export function commandLineText(command: Pick<DeskCommandState, "mode" | "target" | "tokens"> = state) {
  const segments = [
    command.mode === "idle" ? null : command.mode,
    command.target,
    ...command.tokens,
  ].filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join(" ") : "Ready";
}

export function commandSlotNumber(command: DeskCommandState) {
  for (let index = command.tokens.length - 1; index >= 0; index -= 1) {
    const token = command.tokens[index];
    if (/^\d+$/.test(token)) {
      return Number(token);
    }
  }
  return null;
}

function setCommandState(patch: Partial<DeskCommandState>) {
  state = {
    ...state,
    ...patch,
    version: state.version + 1,
  };
  listeners.forEach((listener) => listener());
}

function appendSmartToken(tokens: string[], token: string) {
  if (/^\d$/.test(token)) {
    const previous = tokens[tokens.length - 1];
    if (previous && /^\d+$/.test(previous)) {
      return [...tokens.slice(0, -1), `${previous}${token}`];
    }
  }
  if (token === "." && /^\d+$/.test(tokens[tokens.length - 1] ?? "")) {
    return [...tokens.slice(0, -1), `${tokens[tokens.length - 1]}.`];
  }
  if (/^\d$/.test(token) && /^\d+\.$/.test(tokens[tokens.length - 1] ?? "")) {
    return [...tokens.slice(0, -1), `${tokens[tokens.length - 1]}${token}`];
  }
  return [...tokens, token];
}

function parseCommandText(text: string): Partial<DeskCommandState> {
  const rawTokens = text.trim().split(/\s+/).filter(Boolean);
  let mode: DeskCommandMode = "idle";
  let target: DeskCommandTarget | null = null;
  const tokens: string[] = [];
  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    const parsedMode = modeFromToken(normalized);
    if (parsedMode) {
      mode = parsedMode;
      continue;
    }
    const parsedTarget = targetFromToken(normalized);
    if (parsedTarget) {
      target = parsedTarget;
      continue;
    }
    tokens.push(token);
  }
  return {
    mode,
    target,
    source: null,
    tokens,
    status: text.trim(),
  };
}

function modeFromToken(token: string): DeskCommandMode | null {
  if (token === "store") return "store";
  if (token === "update") return "update";
  if (token === "edit") return "edit";
  if (token === "delete") return "delete";
  if (token === "copy") return "copy";
  if (token === "move") return "move";
  if (token === "select") return "select";
  if (token === "on") return "on";
  if (token === "off") return "off";
  if (token === "stomp") return "stomp";
  return null;
}

function targetFromToken(token: string): DeskCommandTarget | null {
  if (token === "fixture") return "fixture";
  if (token === "group") return "group";
  if (token === "preset") return "preset";
  if (token === "sequence") return "sequence";
  if (token === "cue") return "cue";
  if (token === "executor" || token === "playback") return "executor";
  return null;
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
