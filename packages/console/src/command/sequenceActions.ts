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
  cues: CueModel[];
}

export interface CueModel {
  id: string;
  number: number;
  name: string;
}

export interface SequenceCommandResult {
  document: SequenceDocument;
  sequence: SequenceModel;
  cue: CueModel | null;
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
