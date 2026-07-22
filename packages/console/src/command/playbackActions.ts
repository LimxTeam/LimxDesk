import { invoke } from "@tauri-apps/api/core";
import { pushCommandHistory } from "./commandRuntime";
import type { SequenceCommandResult, SequenceDocument, SequenceModel } from "./sequenceActions";

export interface PlaybackDocument {
  pages: PlaybackPage[];
  selectedPageId: string | null;
  version: number;
}

export interface PlaybackPage {
  id: string;
  number: number;
  name: string;
  executors: ExecutorModel[];
}

export interface ExecutorModel {
  id: string;
  number: number;
  row: number;
  column: number;
  label: string;
  assignment: ExecutorAssignment | null;
  fader: ExecutorFader;
  buttons: ExecutorButtons;
  appearanceColor: string;
}

export interface ExecutorAssignment {
  kind: "sequence";
  objectId: string;
  objectName: string;
}

export interface ExecutorFader {
  master: number;
  temp: number;
  rate: number;
}

export interface ExecutorButtons {
  top: string;
  middle: string;
  bottom: string;
}

export interface PlaybackStoreExecutorResult {
  playback: PlaybackDocument;
  sequence: SequenceCommandResult;
}

/** 引擎的回放状态快照，按 executor 索引。 */
export interface EngineSnapshot {
  executors: ExecutorRuntimeState[];
}

export interface ExecutorRuntimeState {
  pageId: string;
  executorId: string;
  sequenceId: string;
  state: "idle" | "running" | "paused" | "releasing";
  currentCueId: string | null;
  nextCueId: string | null;
  master: number;
  rate: number;
  flash: boolean;
}

/**
 * 推子改动的撤销记录。
 *
 * 推子是纯运行时值，不写 show 文件，所以撤销要把推子推回去，
 * 而不是像文档类操作那样整份替换回去 —— 那会把其他无关改动一起回滚。
 */
export function pushExecutorMasterHistory(
  label: string,
  pageId: string,
  executorId: string,
  before: number,
  after: number,
) {
  pushCommandHistory({
    label,
    undo: async () => {
      await invoke("playback_set_executor_master", { pageId, executorId, master: before });
    },
    redo: async () => {
      await invoke("playback_set_executor_master", { pageId, executorId, master: after });
    },
  });
}

/** 取某个 executor 当前的运行时推子值。没有运行实例时回落到文档里的初值。 */
export async function currentExecutorMaster(
  pageId: string,
  executorId: string,
  fallback: number,
): Promise<number> {
  try {
    const snapshot = await invoke<EngineSnapshot>("playback_runtime_snapshot");
    return (
      snapshot.executors.find(
        (state) => state.pageId === pageId && state.executorId === executorId,
      )?.master ?? fallback
    );
  } catch {
    return fallback;
  }
}

export function pushPlaybackHistory(label: string, before: PlaybackDocument, after: PlaybackDocument) {
  pushCommandHistory({
    label,
    undo: async () => {
      await invoke("playback_replace_current_show", { document: before });
    },
    redo: async () => {
      await invoke("playback_replace_current_show", { document: after });
    },
  });
}

export function pushPlaybackAndSequenceHistory(
  label: string,
  playbackBefore: PlaybackDocument,
  playbackAfter: PlaybackDocument,
  sequenceBefore: SequenceDocument,
  sequenceAfter: SequenceDocument,
) {
  pushCommandHistory({
    label,
    undo: async () => {
      await invoke("sequence_replace_current_show", { document: sequenceBefore });
      await invoke("playback_replace_current_show", { document: playbackBefore });
    },
    redo: async () => {
      await invoke("sequence_replace_current_show", { document: sequenceAfter });
      await invoke("playback_replace_current_show", { document: playbackAfter });
    },
  });
}

export async function assignSequenceToExecutorAction({
  before,
  pageId,
  executorId,
  executorNumber,
  sequence,
}: {
  before: PlaybackDocument;
  pageId: string;
  executorId: string;
  executorNumber: number;
  sequence: SequenceModel;
}) {
  const after = await invoke<PlaybackDocument>("playback_assign_executor", {
    pageId,
    executorId,
    sequenceId: sequence.id,
  });
  const label = `Assign Sequence ${sequence.number} At Executor ${executorNumber}`;
  pushPlaybackHistory(label, before, after);
  return {
    document: after,
    label,
    status: `Assigned Sequence ${sequence.number} At Executor ${executorNumber}`,
  };
}

export async function storeProgrammerOnExecutorAction({
  playbackBefore,
  sequenceBefore,
  pageId,
  executorId,
  executorNumber,
  storeMode,
}: {
  playbackBefore: PlaybackDocument;
  sequenceBefore: SequenceDocument;
  pageId: string;
  executorId: string;
  executorNumber: number;
  storeMode: "merge" | "overwrite";
}) {
  const result = await invoke<PlaybackStoreExecutorResult>("playback_store_programmer_on_executor", {
    pageId,
    executorId,
    storeMode,
  });
  const label = `${storeMode === "overwrite" ? "Update" : "Store"} Executor ${executorNumber}`;
  pushPlaybackAndSequenceHistory(label, playbackBefore, result.playback, sequenceBefore, result.sequence.document);
  return {
    result,
    label,
    status: `${storeMode === "overwrite" ? "Updated" : "Stored"} Executor ${executorNumber}`,
  };
}

export async function clearExecutorAction({
  before,
  pageId,
  executorId,
  executorNumber,
}: {
  before: PlaybackDocument;
  pageId: string;
  executorId: string;
  executorNumber: number;
}) {
  const after = await invoke<PlaybackDocument>("playback_clear_executor", {
    pageId,
    executorId,
  });
  const label = `Clear Executor ${executorNumber}`;
  pushPlaybackHistory(label, before, after);
  return {
    document: after,
    label,
    status: `Cleared Executor ${executorNumber}`,
  };
}

export async function copyOrMoveExecutorAction({
  before,
  pageId,
  sourceExecutorId,
  targetExecutorId,
  sourceNumber,
  targetNumber,
  mode,
}: {
  before: PlaybackDocument;
  pageId: string;
  sourceExecutorId: string;
  targetExecutorId: string;
  sourceNumber: number;
  targetNumber: number;
  mode: "copy" | "move";
}) {
  const after = await invoke<PlaybackDocument>(mode === "copy" ? "playback_copy_executor" : "playback_move_executor", {
    pageId,
    sourceExecutorId,
    targetExecutorId,
  });
  const label = `${mode === "copy" ? "Copy" : "Move"} Executor ${sourceNumber} At ${targetNumber}`;
  pushPlaybackHistory(label, before, after);
  return {
    document: after,
    label,
    status: `${mode === "copy" ? "Copied" : "Moved"} Executor ${sourceNumber} At ${targetNumber}`,
  };
}
