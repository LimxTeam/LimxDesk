import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { clearCommandEntry, pushCommandHistory, useCommandRuntimeSnapshot } from "../command/commandRuntime";
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
  runtime: SequenceRuntimeSnapshot;
}

interface SequenceDocument {
  sequences: SequenceModel[];
  selectedSequenceId: string | null;
  version: number;
}

interface SequenceModel {
  id: string;
  number: number;
  name: string;
  cues: CueModel[];
}

interface CueModel {
  id: string;
  number: number;
  name: string;
}

interface SequenceRuntimeSnapshot {
  states: SequenceRuntimeState[];
}

interface SequenceRuntimeState {
  sequenceId: string;
  active: boolean;
  paused: boolean;
  currentCueId: string | null;
  nextCueId: string | null;
  master: number;
  rate: number;
}

export function PlaybackWindow() {
  const [playback, setPlayback] = useState<PlaybackDocument>({
    pages: [],
    selectedPageId: null,
    version: 0,
  });
  const [sequences, setSequences] = useState<SequenceModel[]>([]);
  const [runtime, setRuntime] = useState<SequenceRuntimeSnapshot>({ states: [] });
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
      const sequenceStateChanged = await listen<SequenceRuntimeSnapshot>(
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
        setSequences([]);
        setRuntime({ states: [] });
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
      setSequences(result.document.sequences);
      setRuntime(result.runtime);
      setSelectedSequenceId((current) =>
        result.document.sequences.some((sequence) => sequence.id === current)
          ? current
          : result.document.selectedSequenceId ?? result.document.sequences[0]?.id ?? "",
      );
    } catch {
      setSequences([]);
      setRuntime({ states: [] });
    }
  }

  async function assignExecutor(executor: Executor, recordHistory = true) {
    if (!page || !selectedSequence) {
      setStatus("Create or select a sequence before assigning playback.");
      return;
    }
    const previousAssignment = executor.assignment;
    const pageId = page.id;
    const executorId = executor.id;
    const sequenceId = selectedSequence.id;
    try {
      const document = await invoke<PlaybackDocument>("playback_assign_executor", {
        pageId,
        executorId,
        sequenceId,
      });
      setPlayback(document);
      setSelectedExecutorId(executorId);
      if (recordHistory) {
        pushCommandHistory({
          label: `Assign Executor ${executor.number}`,
          undo: async () => {
            if (previousAssignment?.kind === "sequence") {
              setPlayback(await invoke<PlaybackDocument>("playback_assign_executor", {
                pageId,
                executorId,
                sequenceId: previousAssignment.objectId,
              }));
            } else {
              setPlayback(await invoke<PlaybackDocument>("playback_clear_executor", { pageId, executorId }));
            }
          },
          redo: async () => {
            setPlayback(await invoke<PlaybackDocument>("playback_assign_executor", { pageId, executorId, sequenceId }));
          },
        });
      }
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function clearExecutor(executor: Executor, recordHistory = true) {
    if (!page) return;
    const previousAssignment = executor.assignment;
    const pageId = page.id;
    const executorId = executor.id;
    try {
      setPlayback(await invoke<PlaybackDocument>("playback_clear_executor", {
        pageId,
        executorId,
      }));
      if (recordHistory && previousAssignment?.kind === "sequence") {
        pushCommandHistory({
          label: `Clear Executor ${executor.number}`,
          undo: async () => {
            setPlayback(await invoke<PlaybackDocument>("playback_assign_executor", {
              pageId,
              executorId,
              sequenceId: previousAssignment.objectId,
            }));
          },
          redo: async () => {
            setPlayback(await invoke<PlaybackDocument>("playback_clear_executor", { pageId, executorId }));
          },
        });
      }
    } catch (error) {
      setStatus(String(error));
    }
  }

  function handleExecutorPrimary(executor: Executor) {
    if (commandState.mode === "store" || commandState.mode === "update") {
      void assignExecutor(executor);
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
      const snapshot = await invoke<SequenceRuntimeSnapshot>("playback_fire_executor", {
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
    setPlayback((current) => updateExecutorMasterLocal(current, page.id, executor.id, next));
    try {
      setPlayback(await invoke<PlaybackDocument>("playback_set_executor_master", {
        pageId: page.id,
        executorId: executor.id,
        master: next,
      }));
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
                const state = stateForExecutor(executor, runtime);
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
  state: SequenceRuntimeState | null;
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
          : state?.active
            ? "1px solid rgba(120,217,120,0.55)"
            : "1px solid var(--lx-stroke)",
        borderRadius: "var(--lx-radius-sm)",
        background: assigned
          ? "linear-gradient(180deg, rgba(44,49,60,0.98), rgba(18,20,26,0.98))"
          : "rgba(0,0,0,0.22)",
        overflow: "hidden",
        boxShadow: state?.active ? "0 0 0 1px rgba(120,217,120,0.24) inset" : undefined,
      }}
    >
      <div style={executorHeaderStyle}>
        <span className="lx-code">{executor.number}</span>
        <span style={{ color: state?.active ? "var(--lx-action-bright)" : "var(--lx-fg-tertiary)" }}>
          {state?.active ? "RUN" : "OFF"}
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

function stateForExecutor(executor: Executor, runtime: SequenceRuntimeSnapshot) {
  const sequenceId = executor.assignment?.objectId;
  if (!sequenceId) return null;
  return runtime.states.find((state) => state.sequenceId === sequenceId) ?? null;
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
