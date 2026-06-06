import { useSyncExternalStore } from "react";

export type DeskCommandMode =
  | "idle"
  | "store"
  | "update"
  | "edit"
  | "delete"
  | "copy"
  | "move"
  | "assign"
  | "select"
  | "on"
  | "off"
  | "stomp";

export type DeskCommandTarget = "fixture" | "group" | "preset" | "sequence" | "cue" | "executor";
export type DeskCommandOperator = "Thru" | "+" | "-" | "If" | "At" | "/" | ".";

export interface DeskCommandSource {
  pool: "group" | "preset" | "sequence" | "cue" | "executor";
  id: number | string;
  category?: string;
  label: string;
}

export interface DeskCommandObjectPhrase {
  target: DeskCommandTarget;
  numbers: number[];
}

export interface DeskCommandState {
  mode: DeskCommandMode;
  target: DeskCommandTarget | null;
  source: DeskCommandSource | null;
  tokens: string[];
  objectPhrases: DeskCommandObjectPhrase[];
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

export type ParsedDeskCommand = Pick<DeskCommandState, "mode" | "target" | "source" | "tokens" | "objectPhrases" | "status">;

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
  objectPhrases: [],
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
  const nextTokens = appendSmartToken(state.tokens, normalizeToken(token));
  setCommandState({
    tokens: nextTokens,
    objectPhrases: [],
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
    setCommandState({
      tokens,
      objectPhrases: [],
      status: tokens.length > 0 ? commandLineText({ ...state, tokens }) : commandModeStatus(state.mode),
    });
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
    objectPhrases: [],
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
  const trimmed = text.trim();
  if (!trimmed) {
    setCommandState({ status: "No command entered" });
    return;
  }

  const immediate = immediateCommandFromText(trimmed);
  if (immediate === "undo") {
    await undoLastCommand();
    return;
  }
  if (immediate === "redo") {
    await redoLastCommand();
    return;
  }

  const parsed = parseCommandText(trimmed);
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

export function commandLineText(
  command: Pick<DeskCommandState, "mode" | "target" | "tokens"> & Partial<Pick<DeskCommandState, "source" | "objectPhrases">> = state,
) {
  if (command.objectPhrases && command.objectPhrases.length > 1) {
    const segments = [
      command.mode === "idle" ? null : command.mode,
      command.source?.label,
      formatObjectPhrase(command.objectPhrases[0]),
      "At",
      formatObjectPhrase(command.objectPhrases[1]),
      ...command.tokens.filter((token) => token.toLowerCase() === "if" || token === "+" || token === "-"),
    ].filter((segment): segment is string => Boolean(segment));
    return segments.length > 0 ? segments.join(" ") : "Ready";
  }

  const segments = [
    command.mode === "idle" ? null : command.mode,
    command.target,
    command.source?.label,
    ...command.tokens,
  ].filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join(" ") : "Ready";
}

function formatObjectPhrase(phrase: DeskCommandObjectPhrase | undefined) {
  if (!phrase) return null;
  return `${titleCase(phrase.target)} ${formatCommandNumbers(phrase.numbers)}`;
}

function formatCommandNumbers(numbers: number[]) {
  const segments: string[] = [];
  for (let index = 0; index < numbers.length; index += 1) {
    const start = numbers[index];
    if (!Number.isInteger(start)) {
      segments.push(String(start));
      continue;
    }

    let endIndex = index;
    while (
      endIndex + 1 < numbers.length &&
      Number.isInteger(numbers[endIndex + 1]) &&
      numbers[endIndex + 1] === numbers[endIndex] + 1
    ) {
      endIndex += 1;
    }

    if (endIndex - index >= 2) {
      segments.push(`${start} Thru ${numbers[endIndex]}`);
      index = endIndex;
    } else {
      segments.push(String(start));
    }
  }
  return segments.join(" ");
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

export function commandNumbers(command: DeskCommandState) {
  return command.tokens
    .filter((token) => /^\d+(?:\.\d+)?$/.test(token))
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

export function commandHasToken(command: DeskCommandState, token: string) {
  const normalized = normalizeToken(token).toLowerCase();
  return command.tokens.some((item) => item.toLowerCase() === normalized);
}

export function commandValueAfter(command: DeskCommandState, token: string) {
  const normalized = normalizeToken(token).toLowerCase();
  const index = command.tokens.findIndex((item) => item.toLowerCase() === normalized);
  if (index < 0) return null;
  for (const item of command.tokens.slice(index + 1)) {
    if (/^\d+(?:\.\d+)?$/.test(item)) {
      const value = Number(item);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

export function commandNumberSet(command: DeskCommandState) {
  const result = new Set<number>();
  let operator: "+" | "-" = "+";
  for (let index = 0; index < command.tokens.length; index += 1) {
    const token = command.tokens[index];
    if (token === "+") {
      operator = "+";
      continue;
    }
    if (token === "-") {
      operator = "-";
      continue;
    }
    if (!/^\d+$/.test(token)) {
      continue;
    }

    const start = Number(token);
    let values = [start];
    if (command.tokens[index + 1] === "Thru" && /^\d+$/.test(command.tokens[index + 2] ?? "")) {
      const end = Number(command.tokens[index + 2]);
      const step = start <= end ? 1 : -1;
      values = [];
      for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
        values.push(value);
      }
      index += 2;
    }

    for (const value of values) {
      if (operator === "-") {
        result.delete(value);
      } else {
        result.add(value);
      }
    }
  }
  return Array.from(result).sort((left, right) => left - right);
}

export function commandSourceTargetSlotPair(
  command: DeskCommandState,
  pool?: DeskCommandSource["pool"],
): { source: number; target: number } | null {
  const phrasePair = commandObjectPhrasePair(command, pool);
  if (phrasePair) return phrasePair;
  const tokenPair = commandSourceTargetPairFromTokens(command.tokens);
  if (tokenPair) return tokenPair;
  if (!command.source || (pool && command.source.pool !== pool)) return null;
  const source = Number(command.source.id);
  const target = commandSlotNumber(command);
  if (!Number.isInteger(source) || target === null) return null;
  return { source, target };
}

export function commandObjectNumbers(command: DeskCommandState, target: DeskCommandTarget) {
  return command.objectPhrases
    .filter((phrase) => phrase.target === target)
    .flatMap((phrase) => phrase.numbers);
}

export function commandObjectPhrasePair(command: DeskCommandState, target?: DeskCommandTarget): { source: number; target: number } | null {
  const phrases = target ? command.objectPhrases.filter((phrase) => phrase.target === target) : command.objectPhrases;
  if (phrases.length < 2) return null;
  const source = phrases[0]?.numbers.at(-1) ?? null;
  const destination = phrases[1]?.numbers[0] ?? null;
  if (source === null || destination === null || !Number.isInteger(source) || !Number.isInteger(destination)) return null;
  return { source, target: destination };
}

function commandSourceTargetPairFromTokens(tokens: string[]): { source: number; target: number } | null {
  const atIndex = tokens.findIndex((token) => token.toLowerCase() === "at");
  if (atIndex <= 0 || atIndex >= tokens.length - 1) return null;
  const source = lastInteger(tokens.slice(0, atIndex));
  const target = firstInteger(tokens.slice(atIndex + 1));
  if (!source || !target) return null;
  return { source, target };
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
  if (isStandaloneOperator(token)) {
    if (token === "." && /^\d+$/.test(tokens[tokens.length - 1] ?? "")) {
      return [...tokens.slice(0, -1), `${tokens[tokens.length - 1]}.`];
    }
    if (tokens[tokens.length - 1] === token && token !== "+" && token !== "-") {
      return tokens;
    }
    return [...tokens, token];
  }
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

function firstInteger(tokens: string[]) {
  for (const token of tokens) {
    if (/^\d+$/.test(token)) return Number(token);
  }
  return null;
}

function lastInteger(tokens: string[]) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(tokens[index])) return Number(tokens[index]);
  }
  return null;
}

function normalizeToken(token: string) {
  const trimmed = token.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "thru" || lower === "through") return "Thru";
  if (lower === "if") return "If";
  if (lower === "at") return "At";
  if (lower === "please" || lower === "enter") return "Please";
  return trimmed;
}

function isStandaloneOperator(token: string) {
  return token === "Thru" || token === "+" || token === "-" || token === "If" || token === "At" || token === "/" || token === ".";
}

export function parseCommandText(text: string): ParsedDeskCommand {
  const rawTokens = tokenizeCommandText(text);
  let mode: DeskCommandMode = "idle";
  let target: DeskCommandTarget | null = null;
  const tokens: string[] = [];
  const normalizedTokens: string[] = [];
  for (const rawToken of rawTokens) {
    const token = normalizeToken(rawToken);
    const normalized = token.toLowerCase();
    if (normalized === "please") {
      continue;
    }
    normalizedTokens.push(token);
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
  const objectPhrases = parseObjectPhrases(normalizedTokens);
  return {
    mode,
    target,
    source: null,
    tokens,
    objectPhrases,
    status: commandLineText({ mode, target, source: null, tokens, objectPhrases }),
  };
}

function tokenizeCommandText(text: string) {
  return text.match(/\d+(?:\.\d+)?|[a-zA-Z]+|[+\-/]/g) ?? [];
}

function parseObjectPhrases(tokens: string[]): DeskCommandObjectPhrase[] {
  const phrases: DeskCommandObjectPhrase[] = [];
  let currentTarget: DeskCommandTarget | null = null;
  let currentTokens: string[] = [];

  const flush = () => {
    const numbers = expandPhraseNumbers(currentTokens);
    if (!currentTarget || numbers.length === 0) {
      currentTokens = [];
      return;
    }
    phrases.push({
      target: currentTarget,
      numbers,
    });
    currentTokens = [];
  };

  for (const token of tokens) {
    const target = targetFromToken(token.toLowerCase());
    if (target) {
      flush();
      currentTarget = target;
      continue;
    }
    if (token === "At") {
      flush();
      currentTarget = null;
      continue;
    }
    if (!currentTarget) continue;
    currentTokens.push(token);
  }
  flush();
  return phrases;
}

function expandPhraseNumbers(tokens: string[]) {
  const result = new Set<number>();
  let operator: "+" | "-" = "+";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "+") {
      operator = "+";
      continue;
    }
    if (token === "-") {
      operator = "-";
      continue;
    }
    if (!/^\d+(?:\.\d+)?$/.test(token)) {
      continue;
    }

    const start = Number(token);
    let values = [start];
    if (tokens[index + 1] === "Thru" && /^\d+(?:\.\d+)?$/.test(tokens[index + 2] ?? "")) {
      const end = Number(tokens[index + 2]);
      values = expandRange(start, end);
      index += 2;
    }

    for (const value of values) {
      if (operator === "-") {
        result.delete(value);
      } else {
        result.add(value);
      }
    }
  }

  return Array.from(result).sort((left, right) => left - right);
}

function expandRange(start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return [start, end];
  }
  const step = start <= end ? 1 : -1;
  const values: number[] = [];
  for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
    values.push(value);
  }
  return values;
}

function immediateCommandFromText(text: string): "undo" | "redo" | null {
  const normalized = text.trim().toLowerCase();
  if (normalized === "undo" || normalized === "oops") return "undo";
  if (normalized === "redo") return "redo";
  return null;
}

function modeFromToken(token: string): DeskCommandMode | null {
  if (token === "store") return "store";
  if (token === "update") return "update";
  if (token === "edit") return "edit";
  if (token === "delete" || token === "del") return "delete";
  if (token === "copy") return "copy";
  if (token === "move") return "move";
  if (token === "assign") return "assign";
  if (token === "select" || token === "sel") return "select";
  if (token === "on") return "on";
  if (token === "off") return "off";
  if (token === "stomp") return "stomp";
  if (token === "go") return "on";
  return null;
}

function targetFromToken(token: string): DeskCommandTarget | null {
  if (token === "fixture" || token === "fixtures" || token === "fix" || token === "f") return "fixture";
  if (token === "group" || token === "groups" || token === "grp" || token === "g") return "group";
  if (token === "preset" || token === "presets" || token === "p") return "preset";
  if (token === "sequence" || token === "sequences" || token === "seq" || token === "s") return "sequence";
  if (token === "cue") return "cue";
  if (token === "executor" || token === "executors" || token === "exec" || token === "x" || token === "playback" || token === "desk") return "executor";
  return null;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function commandModeStatus(mode: DeskCommandMode) {
  if (mode === "idle") return "Ready";
  if (mode === "store") return "Store: choose a target slot";
  if (mode === "update") return "Update: choose an existing object";
  if (mode === "edit") return "Edit: choose an object";
  if (mode === "delete") return "Delete: choose an object";
  if (mode === "copy") return "Copy: choose source, then destination";
  if (mode === "move") return "Move: choose source, then destination";
  if (mode === "assign") return "Assign: choose source object, then executor";
  if (mode === "select") return "Select: choose fixtures or objects";
  return `${mode.toUpperCase()} command armed`;
}
