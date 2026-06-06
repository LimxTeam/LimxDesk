import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  clearCommandEntry,
  pushCommandHistory,
  setCommandSource,
  useCommandRuntimeSnapshot,
} from "../command/commandRuntime";
import { clearWorkspaceRuntimeCache } from "./workspaceRuntime";

interface SequenceLoadResult {
  document: SequenceDocument;
  runtime: SequenceRuntimeSnapshot;
}

interface SequenceCommandResult {
  document: SequenceDocument;
  sequence: SequenceModel;
  cue: CueModel | null;
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
  priority: number;
  tracking: boolean;
  releaseOnOff: boolean;
  protected: boolean;
  recipeSlots: unknown[];
  cues: CueModel[];
  updatedAtMs: number;
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

const SEQUENCE_POOL_SLOT_COUNT = 120;

export function SequencePoolWindow() {
  const [document, setDocument] = useState<SequenceDocument>({
    sequences: [],
    selectedSequenceId: null,
    version: 0,
  });
  const [runtime, setRuntime] = useState<SequenceRuntimeSnapshot>({ states: [] });
  const [status, setStatus] = useState("No show loaded");
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const commandState = useCommandRuntimeSnapshot();

  const sequencesByNumber = useMemo(() => {
    const map = new Map<number, SequenceModel>();
    for (const sequence of document.sequences) {
      map.set(sequence.number, sequence);
    }
    return map;
  }, [document.sequences]);

  const totals = useMemo(() => {
    const running = runtime.states.filter((state) => state.active).length;
    const cues = document.sequences.reduce((total, sequence) => total + sequence.cues.length, 0);
    return { sequences: document.sequences.length, running, cues };
  }, [document.sequences, runtime.states]);

  useEffect(() => {
    void loadSequences();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const sequenceChanged = await listen("sequence:changed", () => {
        clearWorkspaceRuntimeCache(["frames"]);
        void loadSequences();
      });
      const stateChanged = await listen<SequenceRuntimeSnapshot>("sequence:state-changed", (event) => {
        clearWorkspaceRuntimeCache(["frames"]);
        setRuntime(event.payload);
      });
      const showLoaded = await listen("show:loaded", () => {
        clearWorkspaceRuntimeCache();
        void loadSequences();
      });
      const showDeleted = await listen("show:deleted", () => {
        setDocument({ sequences: [], selectedSequenceId: null, version: 0 });
        setRuntime({ states: [] });
        setStatus("No show loaded");
      });

      if (!active) {
        sequenceChanged();
        stateChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(sequenceChanged, stateChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function loadSequences() {
    try {
      const result = await invoke<SequenceLoadResult>("sequence_load_current_show");
      setDocument(result.document);
      setRuntime(result.runtime);
      setStatus(`${result.document.sequences.length} sequences`);
    } catch (error) {
      setDocument({ sequences: [], selectedSequenceId: null, version: 0 });
      setRuntime({ states: [] });
      setStatus(String(error));
    }
  }

  async function handleSlotClick(number: number) {
    if (busySlot !== null) return;
    const sequence = sequencesByNumber.get(number);

    if (commandState.mode === "store" || commandState.mode === "update") {
      await storeSequence(number, sequence, commandState.mode === "update");
      clearCommandEntry();
      return;
    }

    if (commandState.mode === "delete") {
      if (sequence) await deleteSequence(sequence);
      else setStatus(`Sequence ${number} is empty`);
      clearCommandEntry();
      return;
    }

    if (commandState.mode === "copy" || commandState.mode === "move") {
      await handleCopyMove(number, sequence);
      return;
    }

    if (commandState.mode === "on") {
      if (sequence) await fireSequence(sequence, "go");
      else setStatus(`Sequence ${number} is empty`);
      clearCommandEntry();
      return;
    }

    if (commandState.mode === "off") {
      if (sequence) await fireSequence(sequence, "off");
      else setStatus(`Sequence ${number} is empty`);
      clearCommandEntry();
      return;
    }

    if (sequence) {
      await selectSequence(sequence);
      return;
    }

    setStatus(`Empty Sequence ${number}`);
  }

  async function storeSequence(number: number, sequence: SequenceModel | undefined, overwrite: boolean) {
    if (overwrite && !sequence) {
      setStatus(`Sequence ${number} is empty`);
      return;
    }
    const before = document;
    setBusySlot(number);
    try {
      const result = await invoke<SequenceCommandResult>("sequence_store_single_step_program", {
        request: {
          sequenceId: sequence?.id ?? null,
          sequenceNumber: number,
          name: sequence?.name ?? `Sequence ${number}`,
          storeMode: overwrite ? "overwrite" : "merge",
        },
      });
      setDocument(result.document);
      pushSequenceHistory(`${overwrite ? "Update" : "Store"} Sequence ${number}`, before, result.document);
      setStatus(`${overwrite ? "Updated" : "Stored"} Sequence ${number}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusySlot(null);
    }
  }

  async function deleteSequence(sequence: SequenceModel) {
    const before = document;
    setBusySlot(sequence.number);
    try {
      const after = await invoke<SequenceDocument>("sequence_delete", { sequenceId: sequence.id });
      setDocument(after);
      pushSequenceHistory(`Delete Sequence ${sequence.number}`, before, after);
      setStatus(`Deleted Sequence ${sequence.number}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusySlot(null);
    }
  }

  async function handleCopyMove(number: number, sequence: SequenceModel | undefined) {
    const source = commandState.source;
    if (!source) {
      if (!sequence) {
        setStatus(`Sequence ${number} is empty`);
        return;
      }
      setCommandSource({ pool: "sequence", id: number, label: `Sequence ${number}` });
      setStatus(`${commandState.mode.toUpperCase()} source: Sequence ${number}`);
      return;
    }

    if (source.pool !== "sequence" || typeof source.id !== "number") {
      setStatus(`${commandState.mode.toUpperCase()} source is not a sequence`);
      return;
    }

    const before = document;
    setBusySlot(number);
    try {
      const after = await invoke<SequenceDocument>(commandState.mode === "copy" ? "sequence_copy" : "sequence_move", {
        sourceNumber: source.id,
        targetNumber: number,
      });
      setDocument(after);
      pushSequenceHistory(
        `${commandState.mode === "copy" ? "Copy" : "Move"} Sequence ${source.id} At ${number}`,
        before,
        after,
      );
      setStatus(`${commandState.mode === "copy" ? "Copied" : "Moved"} Sequence ${source.id} At ${number}`);
      clearCommandEntry();
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusySlot(null);
    }
  }

  async function selectSequence(sequence: SequenceModel) {
    try {
      const next = await invoke<SequenceDocument>("sequence_select", { sequenceId: sequence.id });
      setDocument(next);
      setStatus(`Selected Sequence ${sequence.number}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  async function fireSequence(sequence: SequenceModel, action: "go" | "off") {
    try {
      const next = await invoke<SequenceRuntimeSnapshot>(action === "go" ? "sequence_go" : "sequence_off", {
        sequenceId: sequence.id,
      });
      setRuntime(next);
      setStatus(`${action === "go" ? "Go" : "Off"} Sequence ${sequence.number}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <div style={titleBlockStyle}>
          <strong>Sequence Pool</strong>
          <span>{poolModeLabel(commandState.mode)}</span>
        </div>
        <Metric label="Stored" value={totals.sequences} />
        <Metric label="Running" value={totals.running} active={totals.running > 0} />
        <Metric label="Cues" value={totals.cues} />
        <span className="lx-code" style={statusStyle}>{status}</span>
      </div>

      <div style={poolStyle}>
        {Array.from({ length: SEQUENCE_POOL_SLOT_COUNT }, (_, index) => {
          const number = index + 1;
          const sequence = sequencesByNumber.get(number);
          const state = runtime.states.find((item) => item.sequenceId === sequence?.id) ?? null;
          const selected = document.selectedSequenceId === sequence?.id;
          const source = commandState.source?.pool === "sequence" && commandState.source.id === number;
          return (
            <button
              key={number}
              type="button"
              onClick={() => void handleSlotClick(number)}
              style={slotStyle({
                stored: Boolean(sequence),
                selected,
                running: Boolean(state?.active),
                source,
                armed: commandState.mode !== "idle",
                busy: busySlot === number,
              })}
              title={sequence ? `Sequence ${number}: ${sequence.name}` : `Sequence ${number}`}
            >
              <span style={slotNumberStyle}>{number}</span>
              <strong>{sequence?.name ?? ""}</strong>
              <small className="lx-code">
                {sequence ? sequenceStatus(sequence, state) : emptySlotLabel(commandState.mode)}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function pushSequenceHistory(label: string, before: SequenceDocument, after: SequenceDocument) {
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

function sequenceStatus(sequence: SequenceModel, state: SequenceRuntimeState | null) {
  if (state?.active) return `Run ${Math.round(state.master * 100)}%`;
  if (sequence.cues.length === 1) return "1 cue";
  return `${sequence.cues.length} cues`;
}

function emptySlotLabel(mode: string) {
  if (mode === "store") return "store";
  if (mode === "copy" || mode === "move") return "target";
  return "";
}

function poolModeLabel(mode: string) {
  if (mode === "idle") return "select / go / store";
  if (mode === "store") return "click a slot to store programmer";
  if (mode === "update") return "click stored slot to overwrite";
  if (mode === "delete") return "click stored slot to delete";
  if (mode === "copy") return "source, then destination";
  if (mode === "move") return "source, then destination";
  if (mode === "on") return "click stored slot to Go";
  if (mode === "off") return "click stored slot to Off";
  return `${mode} armed`;
}

function Metric({ label, value, active = false }: { label: string; value: number; active?: boolean }) {
  return (
    <div style={{ ...metricStyle, borderColor: active ? "rgba(120,217,120,0.42)" : "var(--lx-stroke)" }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const rootStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "42px minmax(0, 1fr)",
  height: "100%",
  minHeight: 0,
  background: "var(--lx-bg-abyss)",
};

const toolbarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(160px, 1fr) repeat(3, 76px) minmax(160px, 1fr)",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  padding: "6px 8px",
  borderBottom: "1px solid var(--lx-stroke)",
  background: "rgba(255,255,255,0.025)",
};

const titleBlockStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 0,
  color: "var(--lx-fg-primary)",
  fontSize: 11,
};

const metricStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
  padding: "4px 6px",
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-sm)",
  background: "rgba(0,0,0,0.22)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 9,
  textTransform: "uppercase",
};

const statusStyle: CSSProperties = {
  justifySelf: "end",
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--lx-fg-tertiary)",
};

const poolStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(10, minmax(82px, 1fr))",
  gridAutoRows: 58,
  gap: 6,
  minHeight: 0,
  overflow: "auto",
  padding: 8,
};

function slotStyle({
  stored,
  selected,
  running,
  source,
  armed,
  busy,
}: {
  stored: boolean;
  selected: boolean;
  running: boolean;
  source: boolean;
  armed: boolean;
  busy: boolean;
}): CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "12px minmax(0, 1fr) 12px",
    gap: 2,
    minWidth: 0,
    padding: "5px 6px",
    border: source
      ? "1px solid rgba(245,184,77,0.9)"
      : selected
        ? "1px solid var(--lx-accent-bright)"
        : running
          ? "1px solid rgba(120,217,120,0.62)"
          : armed
            ? "1px solid rgba(245,184,77,0.34)"
            : "1px solid var(--lx-stroke)",
    borderRadius: "var(--lx-radius-sm)",
    background: running
      ? "linear-gradient(180deg, rgba(38,73,43,0.94), rgba(14,24,16,0.98))"
      : stored
        ? "linear-gradient(180deg, rgba(46,52,64,0.96), rgba(18,20,26,0.98))"
        : armed
          ? "rgba(245,184,77,0.06)"
          : "rgba(0,0,0,0.24)",
    color: stored ? "var(--lx-fg-primary)" : "var(--lx-fg-tertiary)",
    textAlign: "left",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.62 : 1,
    overflow: "hidden",
    boxShadow: source
      ? "inset 0 0 0 1px rgba(245,184,77,0.24)"
      : running
        ? "inset 0 0 0 1px rgba(120,217,120,0.22)"
        : undefined,
  };
}

const slotNumberStyle: CSSProperties = {
  color: "var(--lx-accent-bright)",
  fontSize: 9,
  fontWeight: 900,
};
