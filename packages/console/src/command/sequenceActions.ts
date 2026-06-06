import { invoke } from "@tauri-apps/api/core";
import { pushCommandHistory } from "./commandRuntime";

export interface SequenceLoadResult {
  document: SequenceDocument;
}

export interface SequenceDocument {
  sequences: SequenceModel[];
  selectedSequenceId: string | null;
  version: number;
}

export interface SequenceModel {
  id: string;
  number: number;
  name: string;
  priority: number;
  tracking: boolean;
  releaseOnOff: boolean;
  protected: boolean;
  recipeSlots: SequenceRecipeSlot[];
  cues: CueModel[];
  updatedAtMs: number;
}

export interface SequenceRecipeSlot {
  id: string;
  engineKind: string;
  label: string;
  enabled: boolean;
}

export interface CueModel {
  id: string;
  number: number;
  name: string;
  trigger: CueTrigger;
  timing: CueTiming;
  parts: CuePart[];
  enabled: boolean;
  notes: string;
  updatedAtMs: number;
}

export interface CuePart {
  id: number;
  name: string;
  timing: CueTiming;
  values: CueValue[];
  steps: CueStep[];
}

export interface CueStep {
  id: number;
  name: string;
  timing: CueTiming;
  values: CueValue[];
}

export interface CueValue {
  fixtureId: string;
  attribute: string;
  featureGroup: string;
  layer: "absolute" | "relative" | "fade" | "delay";
  numeric: number | null;
  text: string | null;
  active: boolean;
  source: string;
}

export interface CueTrigger {
  kind: string;
  time: string | null;
}

export interface CueTiming {
  fadeIn: number;
  fadeOut: number;
  delayIn: number;
  delayOut: number;
  duration: number | null;
}

export interface SequenceCommandResult {
  document: SequenceDocument;
  sequence: SequenceModel;
  cue: CueModel | null;
}

export interface CuePatch {
  name?: string;
  number?: number;
  enabled?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  delayIn?: number;
  delayOut?: number;
  notes?: string;
}

export function pushSequenceHistory(label: string, before: SequenceDocument, after: SequenceDocument) {
  pushCommandHistory({
    label,
    undo: async () => {
      await invoke("sequence_replace_current_show", { document: before });
    },
    redo: async () => {
      await invoke("sequence_replace_current_show", { document: after });
    },
  });
}

export async function storeSingleStepSequence({
  before,
  number,
  sequence,
  overwrite,
}: {
  before: SequenceDocument;
  number: number;
  sequence: SequenceModel | null | undefined;
  overwrite: boolean;
}) {
  const result = await invoke<SequenceCommandResult>("sequence_store_single_step_program", {
    request: {
      sequenceId: sequence?.id ?? null,
      sequenceNumber: number,
      name: sequence?.name ?? `Sequence ${number}`,
      storeMode: overwrite ? "overwrite" : "merge",
    },
  });
  const label = `${overwrite ? "Update" : "Store"} Sequence ${number}`;
  pushSequenceHistory(label, before, result.document);
  return {
    result,
    label,
    status: `${overwrite ? "Updated" : "Stored"} Sequence ${number}`,
  };
}

export async function deleteSequenceAction(before: SequenceDocument, sequence: SequenceModel) {
  const after = await invoke<SequenceDocument>("sequence_delete", { sequenceId: sequence.id });
  const label = `Delete Sequence ${sequence.number}`;
  pushSequenceHistory(label, before, after);
  return {
    document: after,
    label,
    status: `Deleted Sequence ${sequence.number}`,
  };
}

export async function copyOrMoveSequenceAction({
  before,
  sourceNumber,
  targetNumber,
  mode,
}: {
  before: SequenceDocument;
  sourceNumber: number;
  targetNumber: number;
  mode: "copy" | "move";
}) {
  const after = await invoke<SequenceDocument>(mode === "copy" ? "sequence_copy" : "sequence_move", {
    sourceNumber,
    targetNumber,
  });
  const label = `${mode === "copy" ? "Copy" : "Move"} Sequence ${sourceNumber} At ${targetNumber}`;
  pushSequenceHistory(label, before, after);
  return {
    document: after,
    label,
    status: `${mode === "copy" ? "Copied" : "Moved"} Sequence ${sourceNumber} At ${targetNumber}`,
  };
}

export async function storeCueAction({
  before,
  sequenceId,
  cueId,
  cueNumber,
  cueName,
  storeMode,
}: {
  before: SequenceDocument;
  sequenceId: string;
  cueId: string | null;
  cueNumber: number | null;
  cueName: string | null;
  storeMode: "merge" | "overwrite";
}) {
  const result = await invoke<SequenceCommandResult>("sequence_store_programmer", {
    request: {
      sequenceId,
      cueId,
      cueNumber,
      cueName,
      storeMode,
    },
  });
  const label = `${storeMode === "overwrite" ? "Update" : "Store"} Cue ${formatCueNumber(cueNumber ?? result.cue?.number ?? "next")}`;
  pushSequenceHistory(label, before, result.document);
  return {
    result,
    label,
    status: `${storeMode === "overwrite" ? "Updated" : "Stored"} Cue ${formatCueNumber(cueNumber ?? result.cue?.number ?? "next")}`,
  };
}

export async function deleteCueAction({
  before,
  sequenceId,
  cue,
}: {
  before: SequenceDocument;
  sequenceId: string;
  cue: CueModel;
}) {
  const result = await invoke<SequenceCommandResult>("sequence_delete_cue", {
    sequenceId,
    cueId: cue.id,
  });
  const label = `Delete Cue ${formatCueNumber(cue.number)}`;
  pushSequenceHistory(label, before, result.document);
  return {
    result,
    label,
    status: `Deleted Cue ${formatCueNumber(cue.number)}`,
  };
}

export async function updateCueAction({
  before,
  sequenceId,
  cue,
  patch,
}: {
  before: SequenceDocument;
  sequenceId: string;
  cue: CueModel;
  patch: CuePatch;
}) {
  const result = await invoke<SequenceCommandResult>("sequence_update_cue", {
    sequenceId,
    cueId: cue.id,
    patch,
  });
  const label = `Update Cue ${formatCueNumber(cue.number)}`;
  pushSequenceHistory(label, before, result.document);
  return {
    result,
    label,
    status: `Updated Cue ${formatCueNumber(result.cue?.number ?? cue.number)}`,
  };
}

export async function copyOrMoveCueAction({
  before,
  sequenceId,
  sourceNumber,
  targetNumber,
  mode,
}: {
  before: SequenceDocument;
  sequenceId: string;
  sourceNumber: number;
  targetNumber: number;
  mode: "copy" | "move";
}) {
  const result = await invoke<SequenceCommandResult>(mode === "copy" ? "sequence_copy_cue" : "sequence_move_cue", {
    sequenceId,
    sourceNumber,
    targetNumber,
  });
  const label = `${mode === "copy" ? "Copy" : "Move"} Cue ${formatCueNumber(sourceNumber)} At ${formatCueNumber(targetNumber)}`;
  pushSequenceHistory(label, before, result.document);
  return {
    result,
    label,
    status: `${mode === "copy" ? "Copied" : "Moved"} Cue ${formatCueNumber(sourceNumber)} At ${formatCueNumber(targetNumber)}`,
  };
}

function formatCueNumber(value: number | string) {
  if (typeof value === "string") return value;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
