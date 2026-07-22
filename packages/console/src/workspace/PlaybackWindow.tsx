import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  clearCommandEntry,
  commandSlotNumber,
  registerCommandHandler,
  setCommandSource,
  useCommandRuntimeSnapshot,
} from "../command/commandRuntime";
import {
  assignSequenceToExecutorAction,
  clearExecutorAction,
  copyOrMoveExecutorAction,
  storeProgrammerOnExecutorAction,
} from "../command/playbackActions";
import type { SequenceDocument, SequenceModel } from "../command/sequenceActions";
import { clearWorkspaceRuntimeCache } from "./workspaceRuntime";

interface PlaybackDocument {
  pages: PlaybackPage[];
  selectedPageId: string | null;
  version: number;
}

interface PlaybackPage {
  id: string;
  number: number;
  name: string;
  executors: Executor[];
}

interface Executor {
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

interface ExecutorAssignment {
  kind: "sequence";
  objectId: string;
  objectName: string;
}

interface ExecutorFader {
  master: number;
  temp: number;
  rate: number;
}

interface ExecutorButtons {
  top: string;
  middle: string;
  bottom: string;
}

interface SequenceLoadResult {
  document: SequenceDocument;
  runtime: EngineSnapshot;
}

interface EngineSnapshot {
  executors: ExecutorRuntimeState[];
}

/** 回放状态按 executor 索引 —— 同一个 sequence 挂在多个 executor 上时各有各的播放头。 */
interface ExecutorRuntimeState {
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

export function PlaybackWindow() {
  const [playback, setPlayback] = useState<PlaybackDocument>({
    pages: [],
    selectedPageId: null,
    version: 0,
  });
  const [sequenceDocument, setSequenceDocument] = useState<SequenceDocument>({
    sequences: [],
    selectedSequenceId: null,
    version: 0,
  });
  const [sequences, setSequences] = useState<SequenceModel[]>([]);
  const [runtime, setRuntime] = useState<EngineSnapshot>({ executors: [] });
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [selectedExecutorId, setSelectedExecutorId] = useState("");
  const [status, setStatus] = useState("Ready");
  const commandState = useCommandRuntimeSnapshot();

  const page = useMemo(
    () =>
      playback.pages.find((item) => item.id === selectedPageId) ??
      playback.pages.find((item) => item.id === playback.selectedPageId) ??
      playback.pages[0] ??
      null,
    [playback.pages, playback.selectedPageId, selectedPageId],
  );
  const selectedSequence = useMemo(
    () =>
      sequences.find((sequence) => sequence.id === selectedSequenceId) ??
      sequences[0] ??
      null,
    [selectedSequenceId, sequences],
  );
  const executorsByRow = useMemo(() => {
    const rows = new Map<number, Executor[]>();
    for (const executor of page?.executors ?? []) {
      rows.set(executor.row, [...(rows.get(executor.row) ?? []), executor]);
    }
    for (const rowExecutors of rows.values()) {
      rowExecutors.sort((left, right) => left.column - right.column);
    }
    return Array.from(rows.entries()).sort(([left], [right]) => left - right);
  }, [page?.executors]);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];
    const register = async () => {
      const playbackChanged = await listen("playback:changed", () => {
        void loadPlayback();
      });
      const sequenceChanged = await listen("sequence:changed", () => {
        clearWorkspaceRuntimeCache(["frames"]);
        void loadSequences();
      });
      const sequenceStateChanged = await listen<EngineSnapshot>(
        "sequence:state-changed",
        (event) => {
          clearWorkspaceRuntimeCache(["frames"]);
          setRuntime(event.payload);
        },
      );
      const showLoaded = await listen("show:loaded", () => {
        clearWorkspaceRuntimeCache();
        void loadAll();
      });
      const showDeleted = await listen("show:deleted", () => {
        setPlayback({ pages: [], selectedPageId: null, version: 0 });
        setSequenceDocument({ sequences: [], selectedSequenceId: null, version: 0 });
        setSequences([]);
        setRuntime({ executors: [] });
        setStatus("No show loaded");
      });

      if (!active) {
        playbackChanged();
        sequenceChanged();
        sequenceStateChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(playbackChanged, sequenceChanged, sequenceStateChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    return registerCommandHandler("playback-window", async (command) => {
      if (command.target !== "executor") return false;
      const number = commandSlotNumber(command);
      if (!number) {
        setStatus("Executor command needs an executor number");
        return { handled: true, keepCommand: true, status: "Executor command needs an executor number" };
      }
      const executor = page?.executors.find((item) => item.number === number);
      if (!executor) {
        setStatus(`Executor ${number} not found on current page`);
        return { handled: true, keepCommand: true, status: `Executor ${number} not found on current page` };
      }
      if (command.mode === "store") {
        await storeProgrammerOnExecutor(executor, "merge");
        return { handled: true, status: `Stored Executor ${number}` };
      }
      if (command.mode === "update") {
        await storeProgrammerOnExecutor(executor, "overwrite");
        return { handled: true, status: `Updated Executor ${number}` };
      }
      if (command.mode === "delete") {
        await clearExecutor(executor);
        return { handled: true, status: `Cleared Executor ${number}` };
      }
      if (command.mode === "on") {
        await fireExecutor(executor, "go");
        return { handled: true, status: `Go Executor ${number}` };
      }
      if (command.mode === "off") {
        await fireExecutor(executor, "off");
        return { handled: true, status: `Off Executor ${number}` };
      }
      if (command.mode === "select" || command.mode === "idle") {
        setSelectedExecutorId(executor.id);
        setStatus(`Selected executor ${executor.number}`);
        return { handled: true, status: `Selected Executor ${number}` };
      }
      return false;
    });
  }, [page, selectedSequence, commandState.mode]);

  async function loadAll() {
    await Promise.all([loadPlayback(), loadSequences()]);
  }

  async function loadPlayback() {
    try {
      const document = await invoke<PlaybackDocument>("playback_load_current_show");
      setPlayback(document);
      setSelectedPageId((current) =>
        document.pages.some((page) => page.id === current)
          ? current
          : document.selectedPageId ?? document.pages[0]?.id ?? "",
      );
      setStatus(`${document.pages.length} page${document.pages.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function loadSequences() {
    try {
      const result = await invoke<SequenceLoadResult>("sequence_load_current_show");
      setSequenceDocument(result.document);
      setSequences(result.document.sequences);
      setRuntime(result.runtime);
      setSelectedSequenceId((current) =>
        result.document.sequences.some((sequence) => sequence.id === current)
          ? current
          : result.document.selectedSequenceId ?? result.document.sequences[0]?.id ?? "",
      );
    } catch {
      setSequenceDocument({ sequences: [], selectedSequenceId: null, version: 0 });
      setSequences([]);
      setRuntime({ executors: [] });
    }
  }

  async function assignExecutor(executor: Executor) {
    if (!page) return;
    if (!selectedSequence) {
      await storeProgrammerOnExecutor(executor, "overwrite");
      return;
    }
    await assignSequenceToExecutor(executor, selectedSequence);
  }

  async function assignSequenceToExecutor(executor: Executor, sequence: SequenceModel) {
    if (!page) return;
    const pageId = page.id;
    const executorId = executor.id;
    try {
      const assigned = await assignSequenceToExecutorAction({
        before: playback,
        pageId,
        executorId,
        executorNumber: executor.number,
        sequence,
      });
      setPlayback(assigned.document);
      setSelectedExecutorId(executorId);
      setSelectedSequenceId(sequence.id);
      setStatus(assigned.status);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function storeProgrammerOnExecutor(executor: Executor, storeMode: "merge" | "overwrite") {
    if (!page) return;
    try {
      const stored = await storeProgrammerOnExecutorAction({
        playbackBefore: playback,
        sequenceBefore: sequenceDocument,
        pageId: page.id,
        executorId: executor.id,
        executorNumber: executor.number,
        storeMode,
      });
      setPlayback(stored.result.playback);
      setSequenceDocument(stored.result.sequence.document);
      setSequences(stored.result.sequence.document.sequences);
      setSelectedSequenceId(stored.result.sequence.sequence.id);
      setSelectedExecutorId(executor.id);
      setStatus(stored.status);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function clearExecutor(executor: Executor) {
    if (!page) return;
    const pageId = page.id;
    const executorId = executor.id;
    try {
      const cleared = await clearExecutorAction({
        before: playback,
        pageId,
        executorId,
        executorNumber: executor.number,
      });
      setPlayback(cleared.document);
      setStatus(cleared.status);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function copyOrMoveExecutor(target: Executor) {
    if (!page) return;
    const source = commandState.source;
    if (!source) {
      if (!target.assignment) {
        setStatus(`Executor ${target.number} is empty`);
        return;
      }
      setCommandSource({ pool: "executor", id: target.number, label: `Executor ${target.number}` });
      setSelectedExecutorId(target.id);
      setStatus(`${commandState.mode.toUpperCase()} source: Executor ${target.number}`);
      return;
    }
    if (source.pool !== "executor") {
      setStatus(`${commandState.mode.toUpperCase()} source is not an executor`);
      return;
    }
    const sourceNumber = Number(source.id);
    const sourceExecutor = page.executors.find((item) => item.number === sourceNumber);
    if (!sourceExecutor) {
      setCommandSource(null);
      setStatus(`Executor ${source.id} not found`);
      return;
    }
    if (!sourceExecutor.assignment) {
      setCommandSource(null);
      setStatus(`Executor ${sourceNumber} is empty`);
      return;
    }
    try {
      const mode = commandState.mode === "move" ? "move" : "copy";
      const moved = await copyOrMoveExecutorAction({
        before: playback,
        pageId: page.id,
        sourceExecutorId: sourceExecutor.id,
        targetExecutorId: target.id,
        sourceNumber,
        targetNumber: target.number,
        mode,
      });
      setPlayback(moved.document);
      setSelectedExecutorId(target.id);
      clearCommandEntry(moved.status);
    } catch (error) {
      setStatus(String(error));
    }
  }

  function handleExecutorPrimary(executor: Executor) {
    if (commandState.mode === "assign") {
      const sourceSequence =
        commandState.source?.pool === "sequence" && typeof commandState.source.id === "number"
          ? sequences.find((sequence) => sequence.number === commandState.source?.id)
          : selectedSequence;
      if (sourceSequence) {
        void assignSequenceToExecutor(executor, sourceSequence).then(() => clearCommandEntry());
      } else {
        setStatus("Assign needs a sequence source");
      }
      return;
    }

    if (commandState.mode === "copy" || commandState.mode === "move") {
      void copyOrMoveExecutor(executor);
      return;
    }

    if (commandState.mode === "store" || commandState.mode === "update") {
      void storeProgrammerOnExecutor(executor, commandState.mode === "update" ? "overwrite" : "merge");
      clearCommandEntry();
      return;
    }
    if (commandState.mode === "delete") {
      void clearExecutor(executor);
      clearCommandEntry();
      return;
    }
    setSelectedExecutorId(executor.id);
  }

  async function fireExecutor(executor: Executor, action: "go" | "back" | "pause" | "off" | "flashOn" | "flashOff" | "toggle") {
    if (!page) return;
    try {
      const snapshot = await invoke<EngineSnapshot>("playback_fire_executor", {
        pageId: page.id,
        executorId: executor.id,
        action,
      });
      setRuntime(snapshot);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function setExecutorMaster(executor: Executor, master: number) {
    if (!page) return;
    const next = Number.isFinite(master) ? Math.min(1, Math.max(0, master)) : 1;
    // 推子是纯运行时值：本地先动，后端只更新引擎，不落盘。
    setPlayback((current) => updateExecutorMasterLocal(current, page.id, executor.id, next));
    try {
      setRuntime(
        await invoke<EngineSnapshot>("playback_set_executor_master", {
          pageId: page.id,
          executorId: executor.id,
          master: next,
        }),
      );
    } catch (error) {
      setStatus(String(error));
    }
  }

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <select
          className="lx-input lx-input-sm"
          value={page?.id ?? ""}
          onChange={(event) => setSelectedPageId(event.currentTarget.value)}
          style={{ width: 120 }}
        >
          {playback.pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </select>
        <select
          className="lx-input lx-input-sm"
          value={selectedSequence?.id ?? ""}
          onChange={(event) => setSelectedSequenceId(event.currentTarget.value)}
          style={{ width: 190 }}
        >
          {sequences.length === 0 ? <option value="">No Sequence</option> : null}
          {sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.number} {sequence.name}
            </option>
          ))}
        </select>
        <span style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
          Select executor, assign selected sequence, then use Go/Back/Off.
        </span>
        <span className="lx-code" style={{ marginLeft: "auto", color: "var(--lx-fg-tertiary)" }}>
          {status}
        </span>
      </div>

      <div style={gridScrollStyle}>
        <div style={gridStyle}>
          {executorsByRow.map(([row, executors]) => (
            <div key={row} style={rowStyle}>
              <div style={rowLabelStyle}>{row * 100}</div>
              {executors.map((executor) => {
                const state = stateForExecutor(executor, page.id, runtime);
                const sequence = sequenceForExecutor(executor, sequences);
                const selected = selectedExecutorId === executor.id;
                return (
                  <ExecutorCell
                    key={executor.id}
                    executor={executor}
                    sequence={sequence}
                    state={state}
                    selected={selected}
                    onSelect={() => handleExecutorPrimary(executor)}
                    onAssign={() => assignExecutor(executor)}
                    onClear={() => clearExecutor(executor)}
                    onFire={(action) => fireExecutor(executor, action)}
                    onMaster={(master) => setExecutorMaster(executor, master)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecutorCell({
  executor,
  sequence,
  state,
  selected,
  onSelect,
  onAssign,
  onClear,
  onFire,
  onMaster,
}: {
  executor: Executor;
  sequence: SequenceModel | null;
  state: ExecutorRuntimeState | null;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onClear: () => void;
  onFire: (action: "go" | "back" | "pause" | "off" | "flashOn" | "flashOff" | "toggle") => void;
  onMaster: (master: number) => void;
}) {
  const currentCue = sequence?.cues.find((cue) => cue.id === state?.currentCueId) ?? null;
  const assigned = Boolean(executor.assignment);
  return (
    <div
      onClick={onSelect}
      style={{
        display: "grid",
        gridTemplateRows: "22px minmax(0, 1fr) 28px 28px",
        minWidth: 118,
        minHeight: 132,
        border: selected
          ? "1px solid var(--lx-accent-bright)"
          : isRunning(state)
            ? "1px solid rgba(120,217,120,0.55)"
            : "1px solid var(--lx-stroke)",
        borderRadius: "var(--lx-radius-sm)",
        background: assigned
          ? "linear-gradient(180deg, rgba(44,49,60,0.98), rgba(18,20,26,0.98))"
          : "rgba(0,0,0,0.22)",
        overflow: "hidden",
        boxShadow: isRunning(state) ? "0 0 0 1px rgba(120,217,120,0.24) inset" : undefined,
      }}
    >
      <div style={executorHeaderStyle}>
        <span className="lx-code">{executor.number}</span>
        <span style={{ color: isRunning(state) ? "var(--lx-action-bright)" : "var(--lx-fg-tertiary)" }}>
          {executorStateLabel(state)}
        </span>
      </div>
      <div style={executorBodyStyle}>
        <strong>{executor.assignment?.objectName || "Empty"}</strong>
        <span>{currentCue ? `Cue ${formatCueNumber(currentCue.number)} ${currentCue.name}` : sequence ? `${sequence.cues.length} cues` : "No object"}</span>
        <button className="lx-btn lx-btn-ghost" type="button" onClick={(event) => { event.stopPropagation(); void onAssign(); }}>
          Assign
        </button>
      </div>
      <div style={executorButtonsStyle}>
        <button className="lx-btn lx-btn-ghost" type="button" disabled={!assigned} onClick={(event) => { event.stopPropagation(); onFire("back"); }}>
          Back
        </button>
        <button className="lx-btn lx-btn-primary" type="button" disabled={!assigned} onClick={(event) => { event.stopPropagation(); onFire("go"); }}>
          Go
        </button>
        <button className="lx-btn lx-btn-danger" type="button" disabled={!assigned} onClick={(event) => { event.stopPropagation(); onFire("off"); }}>
          Off
        </button>
      </div>
      <div style={executorFaderStyle}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(executor.fader.master * 100)}
          disabled={!assigned}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMaster(Number(event.currentTarget.value) / 100)}
          style={{ width: "100%" }}
        />
        <button className="lx-btn lx-btn-ghost" type="button" disabled={!assigned} onClick={(event) => { event.stopPropagation(); void onClear(); }}>
          Clear
        </button>
      </div>
    </div>
  );
}

function updateExecutorMasterLocal(document: PlaybackDocument, pageId: string, executorId: string, master: number): PlaybackDocument {
  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === pageId
        ? {
            ...page,
            executors: page.executors.map((executor) =>
              executor.id === executorId
                ? { ...executor, fader: { ...executor.fader, master } }
                : executor,
            ),
          }
        : page,
    ),
  };
}

function stateForExecutor(executor: Executor, pageId: string, runtime: EngineSnapshot) {
  return (
    runtime.executors.find(
      (state) => state.executorId === executor.id && state.pageId === pageId,
    ) ?? null
  );
}

/**
 * 是否处于运行中。
 *
 * 注意不能写成 `state?.state !== "idle"` —— state 为 null 时那个表达式
 * 会得到 true。
 */
function isRunning(state: ExecutorRuntimeState | null) {
  return state !== null && state.state !== "idle";
}

function executorStateLabel(state: ExecutorRuntimeState | null) {
  if (state === null) return "OFF";
  if (state.flash) return "FLASH";
  switch (state.state) {
    case "running":
      return "RUN";
    case "paused":
      return "PAUSE";
    case "releasing":
      return "REL";
    default:
      return "OFF";
  }
}

function sequenceForExecutor(executor: Executor, sequences: SequenceModel[]) {
  const sequenceId = executor.assignment?.objectId;
  if (!sequenceId) return null;
  return sequences.find((sequence) => sequence.id === sequenceId) ?? null;
}

function formatCueNumber(number: number) {
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const rootStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "34px minmax(0, 1fr)",
  height: "100%",
  minHeight: 0,
  background: "var(--lx-bg-abyss)",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  padding: "0 8px",
  borderBottom: "1px solid var(--lx-stroke)",
  background: "rgba(255,255,255,0.025)",
};

const gridScrollStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 8,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  minWidth: 1860,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "38px repeat(15, minmax(118px, 1fr))",
  gap: 6,
};

const rowLabelStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-sm)",
  background: "rgba(0,0,0,0.22)",
  color: "var(--lx-accent-bright)",
  fontWeight: 900,
  fontSize: 10,
};

const executorHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 6px",
  background: "rgba(255,255,255,0.035)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 9,
  fontWeight: 900,
};

const executorBodyStyle: CSSProperties = {
  display: "grid",
  alignContent: "center",
  gap: 5,
  minWidth: 0,
  padding: 7,
  color: "var(--lx-fg-primary)",
  fontSize: 11,
};

const executorButtonsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 4,
  padding: "0 5px",
};

const executorFaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 44px",
  gap: 5,
  alignItems: "center",
  padding: "0 5px 5px",
};
