import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  clearWorkspaceRuntimeCache,
} from "./workspaceRuntime";

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
  recipeSlots: SequenceRecipeSlot[];
  cues: CueModel[];
  updatedAtMs: number;
}

interface SequenceRecipeSlot {
  id: string;
  engineKind: string;
  label: string;
  enabled: boolean;
}

interface CueModel {
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

interface CuePart {
  id: number;
  name: string;
  timing: CueTiming;
  values: CueValue[];
  steps: CueStep[];
}

interface CueStep {
  id: number;
  name: string;
  timing: CueTiming;
  values: CueValue[];
}

interface CueValue {
  fixtureId: string;
  attribute: string;
  featureGroup: string;
  layer: "absolute" | "relative" | "fade" | "delay";
  numeric: number | null;
  text: string | null;
  active: boolean;
  source: string;
}

interface CueTrigger {
  kind: string;
  time: string | null;
}

interface CueTiming {
  fadeIn: number;
  fadeOut: number;
  delayIn: number;
  delayOut: number;
  duration: number | null;
}

interface SequenceRuntimeSnapshot {
  states: SequenceRuntimeState[];
}

interface SequenceRuntimeState {
  sequenceId: string;
  active: boolean;
  paused: boolean;
  currentCueId: string | null;
  previousCueId: string | null;
  nextCueId: string | null;
  master: number;
  rate: number;
  updatedAtMs: number;
}

export function SequenceSheetWindow() {
  const [document, setDocument] = useState<SequenceDocument>({
    sequences: [],
    selectedSequenceId: null,
    version: 0,
  });
  const [runtime, setRuntime] = useState<SequenceRuntimeSnapshot>({ states: [] });
  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [selectedCueId, setSelectedCueId] = useState("");
  const [query, setQuery] = useState("");
  const [singleStepName, setSingleStepName] = useState("");
  const [status, setStatus] = useState("No show loaded");
  const [busy, setBusy] = useState(false);

  const selectedSequence = useMemo(
    () =>
      document.sequences.find((sequence) => sequence.id === selectedSequenceId) ??
      document.sequences.find((sequence) => sequence.id === document.selectedSequenceId) ??
      document.sequences[0] ??
      null,
    [document.selectedSequenceId, document.sequences, selectedSequenceId],
  );
  const sequenceState = useMemo(
    () => runtime.states.find((state) => state.sequenceId === selectedSequence?.id) ?? null,
    [runtime.states, selectedSequence?.id],
  );
  const cues = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = selectedSequence?.cues ?? [];
    if (!needle) return source;
    return source.filter((cue) =>
      `${cue.number} ${cue.name} ${cue.trigger.kind} ${cue.notes} ${cueValueSummary(cue)}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, selectedSequence?.cues]);

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
      const stateChanged = await listen<SequenceRuntimeSnapshot>(
        "sequence:state-changed",
        (event) => {
          clearWorkspaceRuntimeCache(["frames"]);
          setRuntime(event.payload);
        },
      );
      const showLoaded = await listen("show:loaded", () => {
        clearWorkspaceRuntimeCache();
        void loadSequences();
      });
      const showDeleted = await listen("show:deleted", () => {
        setDocument({ sequences: [], selectedSequenceId: null, version: 0 });
        setRuntime({ states: [] });
        setSelectedSequenceId("");
        setSelectedCueId("");
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
      applyLoadResult(result);
      setStatus(`${result.document.sequences.length} sequence${result.document.sequences.length === 1 ? "" : "s"}`);
    } catch (error) {
      setDocument({ sequences: [], selectedSequenceId: null, version: 0 });
      setRuntime({ states: [] });
      setStatus(String(error));
    }
  }

  function applyLoadResult(result: SequenceLoadResult) {
    setDocument(result.document);
    setRuntime(result.runtime);
    const nextSelected =
      result.document.selectedSequenceId ??
      result.document.sequences[0]?.id ??
      "";
    setSelectedSequenceId((current) =>
      result.document.sequences.some((sequence) => sequence.id === current)
        ? current
        : nextSelected,
    );
    setSelectedCueId((current) =>
      result.document.sequences.some((sequence) =>
        sequence.cues.some((cue) => cue.id === current),
      )
        ? current
        : "",
    );
  }

  async function runCommand<T>(command: string, args: Record<string, unknown>, onResult?: (result: T) => void) {
    try {
      setBusy(true);
      const result = await invoke<T>(command, args);
      onResult?.(result);
      if (command !== "sequence_go" && command !== "sequence_back" && command !== "sequence_off") {
        void loadSequences();
      }
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSequence() {
    await runCommand("sequence_create", { name: null });
  }

  async function storeCue() {
    await runCommand("sequence_store_programmer", {
      request: {
        sequenceId: selectedSequence?.id ?? null,
        cueId: selectedCueId || null,
        cueNumber: selectedCueId ? null : nextCueNumber(selectedSequence),
        cueName: null,
        storeMode: "merge",
      },
    });
  }

  async function storeSingleStep(updateSelected: boolean) {
    await runCommand<SequenceCommandResult>(
      "sequence_store_single_step_program",
      {
        request: {
          sequenceId: updateSelected ? selectedSequence?.id ?? null : null,
          name: singleStepName.trim() || (updateSelected ? selectedSequence?.name ?? null : null),
          storeMode: "overwrite",
        },
      },
      (result) => {
        applyLoadResult({ document: result.document, runtime });
        setSelectedSequenceId(result.sequence.id);
        setSelectedCueId(result.cue?.id ?? "");
        setSingleStepName("");
        setStatus(`Single step stored: ${result.sequence.name}`);
      },
    );
  }

  async function updateCue(cue: CueModel, patch: Record<string, unknown>) {
    if (!selectedSequence) return;
    await runCommand("sequence_update_cue", {
      sequenceId: selectedSequence.id,
      cueId: cue.id,
      patch,
    });
  }

  async function deleteCue(cue: CueModel) {
    if (!selectedSequence) return;
    await runCommand("sequence_delete_cue", {
      sequenceId: selectedSequence.id,
      cueId: cue.id,
    });
  }

  async function goToCue(cue: CueModel) {
    if (!selectedSequence) return;
    await runCommand<SequenceRuntimeSnapshot>(
      "sequence_goto_cue",
      {
        sequenceId: selectedSequence.id,
        cueId: cue.id,
      },
      setRuntime,
    );
  }

  function handleSelectSequence(sequenceId: string) {
    setSelectedSequenceId(sequenceId);
    setSelectedCueId("");
    void runCommand("sequence_select", { sequenceId });
  }

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <select
          className="lx-input lx-input-sm"
          value={selectedSequence?.id ?? ""}
          onChange={(event) => handleSelectSequence(event.currentTarget.value)}
          style={{ width: 180 }}
        >
          {document.sequences.length === 0 ? <option value="">No Sequence</option> : null}
          {document.sequences.map((sequence) => (
            <option key={sequence.id} value={sequence.id}>
              {sequence.number} {sequence.name}
            </option>
          ))}
        </select>
        <button className="lx-btn lx-btn-ghost" type="button" disabled={busy} onClick={createSequence}>
          New Sequence
        </button>
        <button className="lx-btn lx-btn-primary" type="button" disabled={busy} onClick={storeCue}>
          Store Cue
        </button>
        <input
          className="lx-input lx-input-sm"
          value={singleStepName}
          onChange={(event) => setSingleStepName(event.currentTarget.value)}
          placeholder="Single step name"
          style={{ width: 132 }}
        />
        <button
          className="lx-btn lx-btn-primary"
          type="button"
          disabled={busy}
          onClick={() => storeSingleStep(false)}
        >
          Store Single
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!selectedSequence || busy}
          onClick={() => storeSingleStep(true)}
        >
          Update Single
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!selectedSequence || busy}
          onClick={() => runCommand<SequenceRuntimeSnapshot>("sequence_go", { sequenceId: selectedSequence?.id ?? null }, setRuntime)}
        >
          Go+
        </button>
        <button
          className="lx-btn lx-btn-ghost"
          type="button"
          disabled={!selectedSequence || busy}
          onClick={() => runCommand<SequenceRuntimeSnapshot>("sequence_back", { sequenceId: selectedSequence?.id ?? null }, setRuntime)}
        >
          Back
        </button>
        <button
          className="lx-btn lx-btn-danger"
          type="button"
          disabled={!selectedSequence || busy}
          onClick={() => runCommand<SequenceRuntimeSnapshot>("sequence_off", { sequenceId: selectedSequence?.id ?? null }, setRuntime)}
        >
          Off
        </button>
        <input
          className="lx-input lx-input-sm"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search cue, value, trigger..."
          style={{ flex: 1, minWidth: 160 }}
        />
      </div>

      <div style={summaryStyle}>
        <Metric label="State" value={sequenceState?.active ? "Running" : "Off"} active={sequenceState?.active} />
        <Metric label="Current" value={currentCueLabel(selectedSequence, sequenceState?.currentCueId)} />
        <Metric label="Next" value={currentCueLabel(selectedSequence, sequenceState?.nextCueId)} />
        <Metric label="Master" value={`${Math.round((sequenceState?.master ?? 1) * 100)}%`} />
        <Metric label="Program" value={selectedSequence?.cues.length === 1 ? "Single Step" : "Multi Cue"} active={selectedSequence?.cues.length === 1} />
        <Metric label="Tracking" value={selectedSequence?.tracking ? "On" : "Off"} active={selectedSequence?.tracking} />
      </div>

      <div style={{ minHeight: 0, overflow: "auto", background: "var(--lx-bg-void)" }}>
        <table style={tableStyle}>
          <thead>
            <tr style={headerRowStyle}>
              <HeaderCell width={64}>Cue</HeaderCell>
              <HeaderCell width={160}>Name</HeaderCell>
              <HeaderCell width={88}>Trigger</HeaderCell>
              <HeaderCell width={72}>Fade</HeaderCell>
              <HeaderCell width={72}>Delay</HeaderCell>
              <HeaderCell width={84}>Values</HeaderCell>
              <HeaderCell>Content</HeaderCell>
              <HeaderCell width={156}>Actions</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {cues.map((cue) => {
              const current = sequenceState?.currentCueId === cue.id;
              const selected = selectedCueId === cue.id;
              return (
                <tr
                  key={cue.id}
                  onClick={() => setSelectedCueId(cue.id)}
                  style={{
                    height: 36,
                    background: current
                      ? "rgba(120,217,120,0.16)"
                      : selected
                        ? "rgba(245,184,77,0.12)"
                        : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <BodyCell mono strong={current}>{formatCueNumber(cue.number)}</BodyCell>
                  <BodyCell>
                    <input
                      className="lx-input lx-input-sm"
                      defaultValue={cue.name}
                      onBlur={(event) => {
                        if (event.currentTarget.value !== cue.name) {
                          void updateCue(cue, { name: event.currentTarget.value });
                        }
                      }}
                    />
                  </BodyCell>
                  <BodyCell>{cue.trigger.kind}</BodyCell>
                  <BodyCell>
                    <NumberEdit value={cue.timing.fadeIn} onCommit={(value) => updateCue(cue, { fadeIn: value })} />
                  </BodyCell>
                  <BodyCell>
                    <NumberEdit value={cue.timing.delayIn} onCommit={(value) => updateCue(cue, { delayIn: value })} />
                  </BodyCell>
                  <BodyCell mono>{cueValueCount(cue)}</BodyCell>
                  <BodyCell>{cueValueSummary(cue)}</BodyCell>
                  <BodyCell>
                    <div style={{ display: "flex", gap: 5 }}>
                      <button className="lx-btn lx-btn-ghost" type="button" onClick={(event) => { event.stopPropagation(); void goToCue(cue); }}>
                        Goto
                      </button>
                      <button className="lx-btn lx-btn-ghost" type="button" onClick={(event) => { event.stopPropagation(); void storeCue(); }}>
                        Merge
                      </button>
                      <button className="lx-btn lx-btn-danger" type="button" onClick={(event) => { event.stopPropagation(); void deleteCue(cue); }}>
                        Del
                      </button>
                    </div>
                  </BodyCell>
                </tr>
              );
            })}
          </tbody>
        </table>
        {selectedSequence && cues.length === 0 ? (
          <div style={emptyStyle}>No cues stored. Select fixtures, adjust programmer values, then Store Cue.</div>
        ) : null}
      </div>

      <div style={footerStyle}>
        <span>{status}</span>
        <span>{selectedSequence ? `${selectedSequence.cues.length} cues / ${selectedSequence.recipeSlots.length} recipe hooks` : "No active sequence"}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div style={{ ...metricStyle, borderColor: active ? "rgba(120,217,120,0.42)" : "var(--lx-stroke)" }}>
      <span>{label}</span>
      <strong style={{ color: active ? "var(--lx-action-bright)" : "var(--lx-fg-primary)" }}>{value}</strong>
    </div>
  );
}

function NumberEdit({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  return (
    <input
      className="lx-input lx-input-sm"
      type="number"
      min={0}
      step={0.1}
      defaultValue={roundTime(value)}
      onBlur={(event) => {
        const next = Number(event.currentTarget.value);
        if (Number.isFinite(next) && next !== value) onCommit(next);
      }}
    />
  );
}

function HeaderCell({ children, width }: { children: React.ReactNode; width?: number }) {
  return <th style={{ ...headerCellStyle, width }}>{children}</th>;
}

function BodyCell({
  children,
  mono = false,
  strong = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={mono ? "lx-code" : undefined}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.045)",
        padding: "0 8px",
        color: strong ? "var(--lx-action-bright)" : "var(--lx-fg-secondary)",
        fontWeight: strong ? 900 : 650,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function cueValueCount(cue: CueModel) {
  return cue.parts.reduce(
    (total, part) => total + part.values.length + part.steps.reduce((stepTotal, step) => stepTotal + step.values.length, 0),
    0,
  );
}

function cueValueSummary(cue: CueModel) {
  const values = cue.parts.flatMap((part) => part.values);
  if (values.length === 0) return "-";
  const groups = new Map<string, number>();
  for (const value of values) {
    groups.set(value.featureGroup || "Control", (groups.get(value.featureGroup || "Control") ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([group, count]) => `${group}:${count}`)
    .join("  ");
}

function currentCueLabel(sequence: SequenceModel | null, cueId?: string | null) {
  if (!sequence || !cueId) return "-";
  const cue = sequence.cues.find((item) => item.id === cueId);
  return cue ? `${formatCueNumber(cue.number)} ${cue.name}` : "-";
}

function nextCueNumber(sequence: SequenceModel | null) {
  if (!sequence || sequence.cues.length === 0) return 1;
  return Math.max(...sequence.cues.map((cue) => cue.number)) + 1;
}

function formatCueNumber(number: number) {
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function roundTime(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

const rootStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "34px 58px minmax(0, 1fr) 24px",
  minHeight: 0,
  height: "100%",
  background: "var(--lx-bg-abyss)",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  padding: "0 8px",
  borderBottom: "1px solid var(--lx-stroke)",
  background: "rgba(255,255,255,0.025)",
};

const summaryStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: 6,
  padding: 8,
  borderBottom: "1px solid var(--lx-stroke)",
};

const metricStyle: CSSProperties = {
  display: "grid",
  gap: 3,
  minWidth: 0,
  padding: "6px 8px",
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-sm)",
  background: "rgba(0,0,0,0.18)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 9,
  textTransform: "uppercase",
};

const tableStyle: CSSProperties = {
  width: "100%",
  minWidth: 980,
  borderCollapse: "collapse",
  fontSize: 11,
};

const headerRowStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  height: 28,
  background: "var(--lx-bg-deep)",
  color: "var(--lx-fg-tertiary)",
  textTransform: "uppercase",
};

const headerCellStyle: CSSProperties = {
  borderBottom: "1px solid var(--lx-stroke)",
  padding: "0 8px",
  textAlign: "left",
  fontWeight: 900,
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0 8px",
  borderTop: "1px solid var(--lx-stroke)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
};

const emptyStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: 140,
  color: "var(--lx-fg-tertiary)",
  fontSize: 11,
};
