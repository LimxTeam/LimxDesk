import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  commandHasToken,
  commandNumberSet,
  commandSlotNumber,
  commandSourceTargetSlotPair,
  commandValueAfter,
  registerCommandHandler,
  type DeskCommandState,
} from "./commandRuntime";
import {
  assignSequenceToExecutorAction,
  clearExecutorAction,
  copyOrMoveExecutorAction,
  storeProgrammerOnExecutorAction,
  type PlaybackDocument,
} from "./playbackActions";
import {
  copyOrMoveSequenceAction,
  copyOrMoveCueAction,
  deleteCueAction,
  deleteSequenceAction,
  storeCueAction,
  storeSingleStepSequence,
  type SequenceLoadResult,
  type SequenceModel,
} from "./sequenceActions";

interface PatchDocument {
  fixtures: PatchFixture[];
}

interface PatchFixture {
  id: string;
  fid: number;
  fixtureTypeId: string;
  fixtureTypeName: string;
  fixtureTypePath: string;
  modeId: string;
  modeName: string;
  channels: number;
}

interface FixtureSelection {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

interface Programmer {
  live: ProgrammerBuffer;
  preview: ProgrammerBuffer;
  mode: "live" | "preview";
  blind: boolean;
  version: number;
}

interface ProgrammerBuffer {
  selectedPartId: number;
  parts: ProgrammerPart[];
}

interface ProgrammerPart {
  id: number;
  label: string | null;
  values: ProgrammerValue[];
}

interface ProgrammerValue {
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

interface FixtureTypeEntry {
  id: string;
  name: string;
  manufacturer: string;
  path: string;
  modes: FixtureTypeMode[];
}

interface FixtureTypeMode {
  id: string;
  name: string;
  channels: number;
  attributes: string[];
  attributeDetails?: FixtureModeAttribute[];
}

interface FixtureModeAttribute {
  name: string;
  featureGroup: string;
  minValue?: number | null;
  maxValue?: number | null;
  defaultValue?: number | null;
  valueKind?: string;
}

export function useConsoleCommandHandlers() {
  useEffect(() => {
    return registerCommandHandler("console-global-objects", async (command) => {
      const inferredNumbers = commandNumberSet(command);
      const inferredSlot = commandSlotNumber(command);
      if (!command.target && command.mode === "store" && inferredNumbers.length === 0) {
        return handleSequenceCommand({ ...command, target: "sequence" });
      }
      if (!command.target && command.mode === "update" && inferredNumbers.length === 0) {
        return handleSequenceCommand({ ...command, target: "sequence" });
      }
      if (command.mode === "assign") {
        return handleAssignCommand(command);
      }
      if (!command.target && inferredSlot && inferredSlot >= 100 && isExecutorMode(command.mode)) {
        return handleExecutorCommand({ ...command, target: "executor" });
      }
      if (!command.target && inferredNumbers.length === 0 && (command.mode === "on" || command.mode === "off")) {
        return handleSelectionOnOffCommand(command);
      }
      if (!command.target && inferredNumbers.length > 0 && (command.mode === "idle" || command.mode === "select")) {
        return handleFixtureCommand({ ...command, target: "fixture" });
      }
      if (command.mode === "stomp") {
        return handleStompCommand(command);
      }
      if (commandHasToken(command, "At") && command.mode !== "copy" && command.mode !== "move") {
        return handleAtCommand(command);
      }
      if (command.target === "fixture") {
        return handleFixtureCommand(command);
      }
      if (command.target === "sequence") {
        return handleSequenceCommand(command);
      }
      if (command.target === "cue") {
        return handleCueCommand(command);
      }
      if (command.target === "executor") {
        return handleExecutorCommand(command);
      }
      if (commandHasToken(command, "If")) {
        return { handled: true, keepCommand: true, status: "If filter is armed; choose an object target or press ESC" };
      }
      return false;
    });
  }, []);
}

async function handleFixtureCommand(command: DeskCommandState) {
  if (command.mode !== "idle" && command.mode !== "select" && command.mode !== "on" && command.mode !== "off") {
    return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Fixture needs a sheet or target workflow` };
  }

  const fixtureNumbers = commandNumberSet(command);
  if (fixtureNumbers.length === 0) {
    return { handled: true, keepCommand: true, status: "Fixture command needs fixture IDs" };
  }

  const document = await invoke<PatchDocument | null>("patch_load_current_show");
  const fixtures = document?.fixtures ?? [];
  const ids = fixtureNumbers
    .map((number) => fixtures.find((fixture) => fixture.fid === number)?.id)
    .filter((id): id is string => Boolean(id));
  let nextIds = ids;
  if (commandHasToken(command, "If")) {
    const current = await invoke<FixtureSelection>("fixture_selection_get");
    const selected = new Set(current.fixtureIds.map(parentFixtureId));
    nextIds = nextIds.filter((id) => selected.has(parentFixtureId(id)));
  }
  if (nextIds.length === 0) {
    return { handled: true, keepCommand: true, status: `No patched fixtures: ${fixtureNumbers.join(", ")}` };
  }

  await invoke<FixtureSelection>("fixture_selection_select", {
    fixtureIds: nextIds,
    primaryFixtureId: nextIds[nextIds.length - 1] ?? nextIds[0] ?? null,
    mode: "replace",
  });

  if (command.mode === "on" || command.mode === "off") {
    const attribute = await resolveDimmerAttribute(nextIds[nextIds.length - 1] ?? nextIds[0] ?? null);
    const value = command.mode === "on" ? atMaximum(attribute) : atMinimum(attribute);
    await invoke<Programmer>("programmer_set_attribute_for_selection", {
      request: {
        attribute: attribute.name,
        featureGroup: attribute.featureGroup,
        layer: "absolute",
        value: {
          numeric: value,
          text: null,
        },
        source: "manual",
      },
    });
    return {
      handled: true,
      status: `${command.mode === "on" ? "On" : "Off"} Fixture ${fixtureNumbers.join(", ")}`,
    };
  }

  return {
    handled: true,
    status: `${commandHasToken(command, "If") ? "Filtered" : "Selected"} Fixture ${fixtureNumbers.join(", ")}`,
  };
}

async function handleSequenceCommand(command: DeskCommandState) {
  const requestedNumber = commandSlotNumber(command);
  const result = await invoke<SequenceLoadResult>("sequence_load_current_show");
  const selected =
    result.document.sequences.find((sequence) => sequence.id === result.document.selectedSequenceId) ??
    result.document.sequences[0] ??
    null;
  const number =
    command.mode === "store"
      ? requestedNumber ?? nextSequenceNumber(result.document.sequences)
      : requestedNumber ?? selected?.number ?? null;
  const existing = number
    ? result.document.sequences.find((sequence) => sequence.number === number)
    : result.document.sequences.find((sequence) => sequence.id === result.document.selectedSequenceId) ?? result.document.sequences[0];

  if ((!number || number < 1) && command.mode !== "on" && command.mode !== "off") {
    return { handled: true, keepCommand: true, status: "Sequence command needs a pool number" };
  }

  if (command.mode === "store" || command.mode === "update") {
    if (command.mode === "update" && !existing) {
      return { handled: true, keepCommand: true, status: "Update Sequence needs an existing sequence" };
    }
    const stored = await storeSingleStepSequence({
      before: result.document,
      number,
      sequence: existing,
      overwrite: command.mode === "update",
    });
    return { handled: true, status: stored.status };
  }

  if (command.mode === "on") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: number ? `Sequence ${number} is empty` : "No selected Sequence" };
    }
    await invoke("sequence_go", { sequenceId: existing.id });
    return { handled: true, status: `Go Sequence ${existing.number}` };
  }

  if (command.mode === "off") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: number ? `Sequence ${number} is empty` : "No selected Sequence" };
    }
    await invoke("sequence_off", { sequenceId: existing.id });
    return { handled: true, status: `Off Sequence ${existing.number}` };
  }

  if (command.mode === "delete") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: `Sequence ${number} is empty` };
    }
    const deleted = await deleteSequenceAction(result.document, existing);
    return { handled: true, status: deleted.status };
  }

  if (command.mode === "copy" || command.mode === "move") {
    const pair = commandSourceTargetSlotPair(command, "sequence");
    if (!pair) {
      return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Sequence needs source At destination` };
    }
    const moved = await copyOrMoveSequenceAction({
      before: result.document,
      sourceNumber: pair.source,
      targetNumber: pair.target,
      mode: command.mode,
    });
    return { handled: true, status: moved.status };
  }

  if (command.mode === "edit") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: `Sequence ${number} is empty` };
    }
    await invoke("sequence_select", { sequenceId: existing.id });
    return { handled: true, status: `Edit Sequence ${number}` };
  }

  if (command.mode === "stomp") {
    return { handled: true, keepCommand: true, status: "STOMP Sequence is not available" };
  }

  if (command.mode === "select" || command.mode === "idle") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: `Sequence ${number} is empty` };
    }
    await invoke("sequence_select", { sequenceId: existing.id });
    return { handled: true, status: `Selected Sequence ${number}` };
  }

  return false;
}

function nextSequenceNumber(sequences: SequenceModel[]) {
  const used = new Set(sequences.map((sequence) => sequence.number));
  for (let number = 1; number <= 9999; number += 1) {
    if (!used.has(number)) return number;
  }
  return sequences.length + 1;
}

function isExecutorMode(mode: DeskCommandState["mode"]) {
  return (
    mode === "store" ||
    mode === "update" ||
    mode === "delete" ||
    mode === "copy" ||
    mode === "move" ||
    mode === "assign" ||
    mode === "edit" ||
    mode === "on" ||
    mode === "off" ||
    mode === "select"
  );
}

function commandSourceTargetNumberPair(command: DeskCommandState) {
  const atIndex = command.tokens.findIndex((token) => token.toLowerCase() === "at");
  if (atIndex <= 0 || atIndex >= command.tokens.length - 1) return null;
  const source = lastNumber(command.tokens.slice(0, atIndex));
  const target = firstNumber(command.tokens.slice(atIndex + 1));
  if (source === null || target === null) return null;
  return { source, target };
}

function commandAssignSequenceExecutorAddress(command: DeskCommandState) {
  const atIndex = command.tokens.findIndex((token) => token.toLowerCase() === "at");
  if (atIndex <= 0 || atIndex >= command.tokens.length - 1) return null;
  const sequenceNumber = lastInteger(command.tokens.slice(0, atIndex));
  const address = commandExecutorAddress({ ...command, tokens: command.tokens.slice(atIndex + 1) });
  if (!sequenceNumber || !address.executorNumber) return null;
  return {
    sequenceNumber,
    pageNumber: address.pageNumber,
    executorNumber: address.executorNumber,
  };
}

function firstNumber(tokens: string[]) {
  for (const token of tokens) {
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
  }
  return null;
}

function lastNumber(tokens: string[]) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (/^\d+(?:\.\d+)?$/.test(tokens[index])) return Number(tokens[index]);
  }
  return null;
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

function numbersEqual(left: number, right: number) {
  return Math.abs(left - right) < Number.EPSILON;
}

async function handleCueCommand(command: DeskCommandState) {
  const number = lastNumber(command.tokens);
  const result = await invoke<SequenceLoadResult>("sequence_load_current_show");
  const selected =
    result.document.sequences.find((sequence) => sequence.id === result.document.selectedSequenceId) ??
    result.document.sequences[0] ??
    null;
  if (!selected) {
    return { handled: true, keepCommand: true, status: "Cue command needs a selected Sequence" };
  }

  if (command.mode === "store" || command.mode === "update") {
    const stored = await storeCueAction({
      before: result.document,
      sequenceId: selected.id,
      cueId: null,
      cueNumber: number ?? null,
      cueName: number ? `Cue ${number}` : null,
      storeMode: command.mode === "update" ? "overwrite" : "merge",
    });
    return { handled: true, status: stored.status };
  }

  if (command.mode === "copy" || command.mode === "move") {
    const pair = commandSourceTargetNumberPair(command);
    if (!pair) {
      return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Cue needs source At destination` };
    }
    const moved = await copyOrMoveCueAction({
      before: result.document,
      sequenceId: selected.id,
      sourceNumber: pair.source,
      targetNumber: pair.target,
      mode: command.mode,
    });
    return { handled: true, status: moved.status };
  }

  if (!number) {
    return { handled: true, keepCommand: true, status: "Cue command needs a cue number" };
  }

  const cue = selected.cues?.find((item) => numbersEqual(item.number, number));
  if (!cue) {
    return { handled: true, keepCommand: true, status: `Cue ${number} is empty` };
  }

  if (command.mode === "delete") {
    const deleted = await deleteCueAction({
      before: result.document,
      sequenceId: selected.id,
      cue,
    });
    return { handled: true, status: deleted.status };
  }

  if (command.mode === "on" || command.mode === "select" || command.mode === "idle") {
    await invoke("sequence_goto_cue", {
      sequenceId: selected.id,
      cueId: cue.id,
    });
    return { handled: true, status: `Goto Cue ${number}` };
  }

  if (command.mode === "off") {
    await invoke("sequence_off", { sequenceId: selected.id });
    return { handled: true, status: `Off Cue ${number}` };
  }

  if (command.mode === "edit") {
    await invoke("sequence_goto_cue", {
      sequenceId: selected.id,
      cueId: cue.id,
    });
    return { handled: true, status: `Edit Cue ${number}` };
  }

  if (command.mode === "stomp") {
    return { handled: true, keepCommand: true, status: "STOMP Cue is not available" };
  }

  return false;
}

async function handleAssignCommand(command: DeskCommandState) {
  const address = commandAssignSequenceExecutorAddress(command);
  if (!address) {
    return { handled: true, keepCommand: true, status: "Assign needs Sequence source At Executor target" };
  }

  const [sequenceResult, playback] = await Promise.all([
    invoke<SequenceLoadResult>("sequence_load_current_show"),
    invoke<PlaybackDocument>("playback_load_current_show"),
  ]);
  const sequence = sequenceResult.document.sequences.find((item) => item.number === address.sequenceNumber);
  if (!sequence) {
    return { handled: true, keepCommand: true, status: `Sequence ${address.sequenceNumber} is empty` };
  }

  const page =
    (address.pageNumber ? playback.pages.find((item) => item.number === address.pageNumber) : null) ??
    playback.pages.find((item) => item.id === playback.selectedPageId) ??
    playback.pages[0] ??
    null;
  const executor = page?.executors.find((item) => item.number === address.executorNumber) ?? null;
  if (!page || !executor) {
    return { handled: true, keepCommand: true, status: `Executor ${address.executorNumber} not found` };
  }

  const assigned = await assignSequenceToExecutorAction({
    before: playback,
    pageId: page.id,
    executorId: executor.id,
    executorNumber: address.executorNumber,
    sequence,
  });
  return {
    handled: true,
    status: assigned.status,
  };
}

async function handleExecutorCommand(command: DeskCommandState) {
  const address = commandExecutorAddress(command);
  const number = address.executorNumber;
  if (!number) {
    return { handled: true, keepCommand: true, status: "Executor command needs an executor number" };
  }

  const playback = await invoke<PlaybackDocument>("playback_load_current_show");
  const page =
    (address.pageNumber ? playback.pages.find((item) => item.number === address.pageNumber) : null) ??
    playback.pages.find((item) => item.id === playback.selectedPageId) ??
    playback.pages[0] ??
    null;
  const executor = page?.executors.find((item) => item.number === number) ?? null;
  if (!page || !executor) {
    return { handled: true, keepCommand: true, status: `Executor ${number} not found` };
  }

  if (command.mode === "store" || command.mode === "update") {
    const sequenceBefore = await invoke<SequenceLoadResult>("sequence_load_current_show");
    const stored = await storeProgrammerOnExecutorAction({
      playbackBefore: playback,
      sequenceBefore: sequenceBefore.document,
      pageId: page.id,
      executorId: executor.id,
      storeMode: command.mode === "update" ? "overwrite" : "merge",
      executorNumber: number,
    });
    return { handled: true, status: stored.status };
  }

  if (command.mode === "delete") {
    const cleared = await clearExecutorAction({
      before: playback,
      pageId: page.id,
      executorId: executor.id,
      executorNumber: number,
    });
    return { handled: true, status: cleared.status };
  }

  if (command.mode === "on" || command.mode === "off") {
    await invoke("playback_fire_executor", {
      pageId: page.id,
      executorId: executor.id,
      action: command.mode === "on" ? "go" : "off",
    });
    return { handled: true, status: `${command.mode === "on" ? "Go" : "Off"} Executor ${number}` };
  }

  if (command.mode === "select" || command.mode === "idle") {
    return { handled: true, status: `Selected Executor ${number}` };
  }

  if (command.mode === "copy" || command.mode === "move") {
    const pair = commandSourceTargetSlotPair(command, "executor");
    if (!pair) {
      return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Executor needs source At destination` };
    }
    const source = page.executors.find((item) => item.number === pair.source);
    const target = page.executors.find((item) => item.number === pair.target);
    if (!source || !target) {
      return { handled: true, keepCommand: true, status: `Executor ${!source ? pair.source : pair.target} not found` };
    }
    if (!source.assignment) {
      return { handled: true, keepCommand: true, status: `Executor ${pair.source} is empty` };
    }
    const moved = await copyOrMoveExecutorAction({
      before: playback,
      pageId: page.id,
      sourceExecutorId: source.id,
      targetExecutorId: target.id,
      sourceNumber: pair.source,
      targetNumber: pair.target,
      mode: command.mode,
    });
    return { handled: true, status: moved.status };
  }

  if (command.mode === "edit") {
    return { handled: true, status: `Edit Executor ${number}` };
  }

  if (command.mode === "stomp") {
    return { handled: true, keepCommand: true, status: "STOMP Executor is not available" };
  }

  return false;
}

function commandExecutorAddress(command: DeskCommandState) {
  const slashIndex = command.tokens.indexOf("/");
  if (slashIndex > 0 && slashIndex < command.tokens.length - 1) {
    return {
      pageNumber: lastInteger(command.tokens.slice(0, slashIndex)),
      executorNumber: firstInteger(command.tokens.slice(slashIndex + 1)),
    };
  }

  return {
    pageNumber: null,
    executorNumber: commandSlotNumber(command),
  };
}

async function handleAtCommand(command: DeskCommandState) {
  const value = commandValueAfter(command, "At");
  if (value === null) {
    return { handled: true, keepCommand: true, status: "At command needs a value" };
  }

  if (command.target === "fixture") {
    const atIndex = command.tokens.findIndex((token) => token.toLowerCase() === "at");
    const fixtureTokens = atIndex >= 0 ? command.tokens.slice(0, atIndex) : command.tokens;
    const selectionResult = await handleFixtureCommand({ ...command, mode: "select", tokens: fixtureTokens });
    if (typeof selectionResult === "object" && selectionResult.handled && selectionResult.keepCommand) {
      return selectionResult;
    }
  }

  const selection = await invoke<FixtureSelection>("fixture_selection_get");
  if (selection.fixtureIds.length === 0) {
    return { handled: true, keepCommand: true, status: "At command needs selected fixtures" };
  }

  const attribute = await resolveDimmerAttribute(selection.primaryFixtureId ?? selection.fixtureIds[0]);
  await invoke<Programmer>("programmer_set_attribute_for_selection", {
    request: {
      attribute: attribute.name,
      featureGroup: attribute.featureGroup,
      layer: "absolute",
      value: {
        numeric: clamp(value, atMinimum(attribute), atMaximum(attribute)),
        text: null,
      },
      source: "manual",
    },
  });
  return { handled: true, status: `At ${value}` };
}

async function handleSelectionOnOffCommand(command: DeskCommandState) {
  const selection = await invoke<FixtureSelection>("fixture_selection_get");
  if (selection.fixtureIds.length === 0) {
    return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} needs selected fixtures or an executor` };
  }

  const attribute = await resolveDimmerAttribute(selection.primaryFixtureId ?? selection.fixtureIds[0]);
  const value = command.mode === "on" ? atMaximum(attribute) : atMinimum(attribute);
  await invoke<Programmer>("programmer_set_attribute_for_selection", {
    request: {
      attribute: attribute.name,
      featureGroup: attribute.featureGroup,
      layer: "absolute",
      value: {
        numeric: value,
        text: null,
      },
      source: "manual",
    },
  });
  return { handled: true, status: `${command.mode === "on" ? "On" : "Off"} selected fixtures` };
}

async function handleStompCommand(command: DeskCommandState) {
  if (command.target && command.target !== "fixture") {
    return { handled: true, keepCommand: true, status: `Stomp ${command.target} is not available` };
  }
  await invoke("programmer_clear", { target: "active" });
  return { handled: true, status: "Stomp active programmer values" };
}

function parentFixtureId(id: string) {
  return id.split("::sub:")[0] ?? id;
}

async function resolveDimmerAttribute(fixtureId: string | null): Promise<FixtureModeAttribute> {
  const fallback = { name: "Dimmer", featureGroup: "Dimmer", minValue: 0, maxValue: 100, valueKind: "percent" };
  if (!fixtureId) return fallback;
  const [patch, types] = await Promise.all([
    invoke<PatchDocument | null>("patch_load_current_show"),
    invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show"),
  ]);
  const parentId = fixtureId.split("::sub:")[0] ?? fixtureId;
  const fixture = patch?.fixtures.find((item) => item.id === parentId);
  if (!fixture) return fallback;
  const fixtureType = types.find(
    (item) =>
      item.id === fixture.fixtureTypeId ||
      item.path === fixture.fixtureTypePath ||
      `${item.manufacturer} ${item.name}`.trim() === fixture.fixtureTypeName,
  );
  const mode =
    fixtureType?.modes.find((item) => item.id === fixture.modeId) ??
    fixtureType?.modes.find((item) => item.name === fixture.modeName) ??
    fixtureType?.modes.find((item) => item.channels === fixture.channels);
  const attributes = mode?.attributeDetails ?? [];
  return (
    attributes.find((attribute) => attribute.featureGroup.toLowerCase() === "dimmer") ??
    attributes.find((attribute) => attribute.name.toLowerCase().includes("dim")) ??
    fallback
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    return value;
  }
  return Math.max(min, Math.min(max, value));
}

function atMinimum(attribute: FixtureModeAttribute) {
  if (attribute.valueKind === "percent") return 0;
  return attribute.minValue ?? 0;
}

function atMaximum(attribute: FixtureModeAttribute) {
  if (attribute.valueKind === "percent") return 100;
  return attribute.maxValue ?? 100;
}
