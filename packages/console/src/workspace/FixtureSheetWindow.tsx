import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  clearWorkspaceRuntimeCache,
  loadCachedDmxFrames,
  loadCachedFixtureTypes,
  loadCachedPatch,
  loadCachedProgrammer,
  loadCachedSelection,
  setWorkspaceRuntimeValue,
} from "./workspaceRuntime";

interface PatchDocument {
  fixtures: PatchFixture[];
}

interface PatchFixture {
  id: string;
  fid: number;
  name: string;
  fixtureTypeId: string;
  fixtureTypeName: string;
  fixtureTypePath: string;
  modeId: string;
  modeName: string;
  channels: number;
  universe: number | null;
  address: number | null;
  stage: string;
  panInvert: boolean;
  tiltInvert: boolean;
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
  subFixtures?: FixtureModeSubFixture[];
}

interface FixtureModeAttribute {
  name: string;
  featureGroup: string;
  dmxSlots: FixtureModeSlot[];
}

interface FixtureModeSlot {
  moduleId?: string | null;
  offsets: number[];
}

interface FixtureModeSubFixture {
  id: string;
  name: string;
  geometry: string;
  index: number;
  firstAddress: number | null;
  channelCount: number;
  attributes: string[];
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
  layer: ProgrammerLayer;
  value: ProgrammerScalar;
  active: boolean;
  source: ProgrammerValueSource;
}

interface ProgrammerScalar {
  numeric: number | null;
  text: string | null;
}

interface DmxUniverseFrame {
  universe: number;
  data: number[];
  sources?: DmxChannelSource[];
}

type ProgrammerLayer = "absolute" | "relative" | "fade" | "delay";
type ProgrammerValueSource = "manual" | "preset" | "output";
type DmxChannelSource = "none" | "default" | "sequence" | "effect" | "programmer";
type FixtureSheetView = "sheet" | "dmx";
type ReadoutMode = "percent" | "decimal";

interface FixtureSheetRow {
  id: string;
  fixture: PatchFixture;
  mode: FixtureTypeMode | null;
  fidLabel: string;
  name: string;
  patchLabel: string;
  channels: number;
  isSubFixture: boolean;
  subFixtureName: string;
  subFixture: FixtureModeSubFixture | null;
  hasSubFixtures: boolean;
  expanded: boolean;
}

interface AttributeGroup {
  name: string;
  attributes: FixtureModeAttribute[];
}

const FEATURE_ORDER = ["Dimmer", "Position", "Gobo", "Color", "Beam", "Focus", "Control", "Shapers"];
const ACTIVE_VALUE_REFRESH_MS = 120;
const SHEET_ROW_HEIGHT = 28;
const SHEET_OVERSCAN_ROWS = 10;
const SHEET_COLUMN_COUNT = 9;

export function FixtureSheetWindow() {
  const [view, setView] = useState<FixtureSheetView>("sheet");
  const [readout, setReadout] = useState<ReadoutMode>("percent");
  const [showValues, setShowValues] = useState(true);
  const [showAttributes, setShowAttributes] = useState(true);
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);
  const [frames, setFrames] = useState<DmxUniverseFrame[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Ready");
  const [sheetScrollTop, setSheetScrollTop] = useState(0);
  const [sheetViewportHeight, setSheetViewportHeight] = useState(320);
  const [expandedFixtureIds, setExpandedFixtureIds] = useState<Set<string>>(() => new Set());
  const [programmer, setProgrammer] = useState<Programmer>({
    live: { selectedPartId: 0, parts: [] },
    preview: { selectedPartId: 0, parts: [] },
    mode: "live",
    blind: false,
    version: 0,
  });
  const viewRef = useRef(view);
  const pendingProgrammerRef = useRef<Programmer | null>(null);
  const programmerFrameRef = useRef<number | null>(null);
  const programmerTimerRef = useRef<number | null>(null);
  const lastProgrammerCommitRef = useRef(0);
  const frameLoadScheduledRef = useRef<number | null>(null);
  const frameLoadInFlightRef = useRef(false);
  const frameLoadPendingRef = useRef(false);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => buildRows(fixtures, fixtureTypes, expandedFixtureIds),
    [expandedFixtureIds, fixtures, fixtureTypes],
  );
  const frameByUniverse = useMemo(() => {
    const byUniverse = new Map<number, DmxUniverseFrame>();
    for (const frame of frames) byUniverse.set(frame.universe, frame);
    return byUniverse;
  }, [frames]);
  const referenceMode = useMemo(() => {
    const primaryRow =
      rows.find((row) => row.id === primaryId) ??
      rows.find((row) => row.fixture.id === parentFixtureId(primaryId));
    return primaryRow?.mode ?? rows.find((row) => row.mode)?.mode ?? null;
  }, [primaryId, rows]);
  const attributeGroups = useMemo(() => buildAttributeGroups(referenceMode), [referenceMode]);
  const activeValuesByFixture = useMemo(() => programmerActiveValuesByFixture(programmer), [programmer]);
  const activeValuesByRow = useMemo(
    () => buildActiveValuesByRow(rows, activeValuesByFixture),
    [activeValuesByFixture, rows],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const activeText = (activeValuesByRow.get(row.id) ?? [])
        .map((value) => `${value.attribute} ${formatProgrammerValue(value)}`)
        .join(" ");
      return `${row.fidLabel} ${row.name} ${row.subFixtureName} ${row.fixture.fixtureTypeName} ${row.fixture.modeName} ${row.patchLabel} ${row.fixture.stage} ${activeText}`
        .toLowerCase()
        .includes(needle);
    });
  }, [activeValuesByRow, query, rows]);
  const virtualSheetRows = useMemo(
    () => virtualizeRows(visibleRows, sheetScrollTop, sheetViewportHeight, SHEET_ROW_HEIGHT, SHEET_OVERSCAN_ROWS),
    [sheetScrollTop, sheetViewportHeight, visibleRows],
  );

  useEffect(() => {
    const element = sheetScrollRef.current;
    if (!element) return;

    const updateViewport = () => setSheetViewportHeight(element.clientHeight || 320);
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    viewRef.current = view;
    if (view === "dmx") {
      requestFrameLoad();
    }
  }, [view]);

  useEffect(() => {
    void loadFixtureTypes();
    void loadPatch();
    void loadSelection();
    void loadProgrammer();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const patchChanged = await listen("patch:changed", () => {
        clearWorkspaceRuntimeCache(["patch", "frames"]);
        void loadPatch();
        requestFrameLoad();
      });
      const fixtureTypesChanged = await listen("fixture-types:changed", () => {
        clearWorkspaceRuntimeCache(["fixtureTypes", "frames"]);
        void loadFixtureTypes();
        requestFrameLoad();
      });
      const showLoaded = await listen("show:loaded", () => {
        clearWorkspaceRuntimeCache();
        void loadFixtureTypes();
        void loadPatch();
        requestFrameLoad();
      });
      const showDeleted = await listen("show:deleted", () => {
        clearWorkspaceRuntimeCache();
        setFixtures([]);
        setFixtureTypes([]);
        setSelectedIds([]);
        setPrimaryId("");
        setAnchorId("");
        setExpandedFixtureIds(new Set());
        setFrames([]);
        setStatus("No show loaded");
      });
      const selectionChanged = await listen<FixtureSelection>(
        "fixture-selection:changed",
        (event) => {
          setWorkspaceRuntimeValue("selection", event.payload);
          setSelectedIds(event.payload.fixtureIds);
          setPrimaryId(event.payload.primaryFixtureId ?? "");
        },
      );
      const programmerChanged = await listen<Programmer>("programmer:changed", (event) => {
        setWorkspaceRuntimeValue("programmer", event.payload);
        clearWorkspaceRuntimeCache(["frames"]);
        scheduleProgrammerUpdate(event.payload);
        requestFrameLoad();
      });
      const outputSent = await listen("output:sent", () => {
        clearWorkspaceRuntimeCache(["frames"]);
        requestFrameLoad();
      });

      if (!active) {
        patchChanged();
        fixtureTypesChanged();
        showLoaded();
        showDeleted();
        selectionChanged();
        programmerChanged();
        outputSent();
        return;
      }
      unlisteners.push(patchChanged, fixtureTypesChanged, showLoaded, showDeleted, selectionChanged, programmerChanged, outputSent);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
      if (programmerFrameRef.current !== null) {
        window.cancelAnimationFrame(programmerFrameRef.current);
        programmerFrameRef.current = null;
      }
      if (programmerTimerRef.current !== null) {
        window.clearTimeout(programmerTimerRef.current);
        programmerTimerRef.current = null;
      }
      if (frameLoadScheduledRef.current !== null) {
        window.cancelAnimationFrame(frameLoadScheduledRef.current);
        frameLoadScheduledRef.current = null;
      }
    };
  }, []);

  async function loadPatch() {
    try {
      const document = await loadCachedPatch<PatchDocument | null>();
      const nextFixtures = document?.fixtures ?? [];
      setFixtures(nextFixtures);
      setSelectedIds((current) => current.filter((id) => nextFixtures.some((fixture) => fixture.id === parentFixtureId(id))));
      setPrimaryId((current) => (nextFixtures.some((fixture) => fixture.id === parentFixtureId(current)) ? current : ""));
      setAnchorId((current) => (nextFixtures.some((fixture) => fixture.id === parentFixtureId(current)) ? current : ""));
      setStatus(`${nextFixtures.length} fixture${nextFixtures.length === 1 ? "" : "s"}`);
    } catch {
      setFixtures([]);
      setSelectedIds([]);
      setPrimaryId("");
      setAnchorId("");
      setStatus("No show loaded");
    }
  }

  async function loadFixtureTypes() {
    try {
      const types = await loadCachedFixtureTypes<FixtureTypeEntry[]>();
      setFixtureTypes(types);
    } catch {
      setFixtureTypes([]);
    }
  }

  async function loadSelection() {
    try {
      const selection = await loadCachedSelection<FixtureSelection>();
      setSelectedIds(selection.fixtureIds);
      setPrimaryId(selection.primaryFixtureId ?? "");
      setAnchorId(selection.primaryFixtureId ?? "");
    } catch {
      setSelectedIds([]);
      setPrimaryId("");
      setAnchorId("");
    }
  }

  async function loadProgrammer() {
    try {
      setProgrammer(await loadCachedProgrammer<Programmer>());
    } catch {
      setProgrammer({
        live: { selectedPartId: 0, parts: [] },
        preview: { selectedPartId: 0, parts: [] },
        mode: "live",
        blind: false,
        version: 0,
      });
    }
  }

  function scheduleProgrammerUpdate(nextProgrammer: Programmer) {
    pendingProgrammerRef.current = nextProgrammer;
    const now = performance.now();
    const elapsed = now - lastProgrammerCommitRef.current;
    if (elapsed < ACTIVE_VALUE_REFRESH_MS) {
      if (programmerTimerRef.current === null) {
        programmerTimerRef.current = window.setTimeout(() => {
          programmerTimerRef.current = null;
          scheduleProgrammerUpdate(pendingProgrammerRef.current ?? nextProgrammer);
        }, ACTIVE_VALUE_REFRESH_MS - elapsed);
      }
      return;
    }

    if (programmerFrameRef.current !== null) return;
    programmerFrameRef.current = window.requestAnimationFrame(() => {
      programmerFrameRef.current = null;
      lastProgrammerCommitRef.current = performance.now();
      const pending = pendingProgrammerRef.current;
      pendingProgrammerRef.current = null;
      if (pending) setProgrammer(pending);
    });
  }

  async function loadFrames() {
    try {
      const nextFrames = await loadCachedDmxFrames<DmxUniverseFrame[]>();
      nextFrames.sort((left, right) => left.universe - right.universe);
      setFrames(nextFrames);
    } catch {
      setFrames([]);
    }
  }

  function requestFrameLoad() {
    if (viewRef.current !== "dmx") return;
    if (frameLoadInFlightRef.current) {
      frameLoadPendingRef.current = true;
      return;
    }
    if (frameLoadScheduledRef.current !== null) return;

    frameLoadScheduledRef.current = window.requestAnimationFrame(() => {
      frameLoadScheduledRef.current = null;
      frameLoadInFlightRef.current = true;
      void loadFrames().finally(() => {
        frameLoadInFlightRef.current = false;
        if (frameLoadPendingRef.current) {
          frameLoadPendingRef.current = false;
          requestFrameLoad();
        }
      });
    });
  }

  const toggleExpanded = useCallback((event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) => {
    event.stopPropagation();
    setExpandedFixtureIds((current) => {
      const next = new Set(current);
      if (next.has(fixtureId)) {
        next.delete(fixtureId);
      } else {
        next.add(fixtureId);
      }
      return next;
    });
  }, []);

  const selectFixture = useCallback((event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) => {
    const additive = event.ctrlKey || event.metaKey;
    const range = event.shiftKey && anchorId;
    const mode = range ? (additive ? "add" : "replace") : additive ? "toggle" : "replace";
    const fixtureIds = range ? getRangeFixtureIds(visibleRows, anchorId, row.id) : [row.id];

    setAnchorId(row.id);
    setPrimaryId(row.id);
    setSelectedIds((current) => {
      if (range) return mergeUnique(additive ? current : [], fixtureIds);
      if (additive) {
        return current.includes(row.id)
          ? current.filter((id) => id !== row.id)
          : [...current, row.id];
      }
      return [row.id];
    });

    void invoke("fixture_selection_select", {
      fixtureIds,
      primaryFixtureId: row.id,
      mode,
    });
  }, [anchorId, visibleRows]);

  return (
    <div
      style={{
        display: "grid",
        height: "100%",
        minHeight: 0,
        gridTemplateRows: "34px minmax(0, 1fr) 24px",
        background: "var(--lx-bg-abyss)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px",
          borderBottom: "1px solid var(--lx-stroke)",
          background: "rgba(255,255,255,0.025)",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}>
          <ToolbarButton active={view === "sheet"} onClick={() => setView("sheet")}>
            Fixture
          </ToolbarButton>
          <ToolbarButton active={view === "dmx"} onClick={() => setView("dmx")}>
            Fixture: DMX
          </ToolbarButton>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search FID, name, type, patch..."
          style={{
            width: "100%",
            height: 24,
            border: "1px solid var(--lx-stroke)",
            borderRadius: "var(--lx-radius-xs)",
            background: "rgba(0,0,0,0.28)",
            color: "var(--lx-fg-primary)",
            fontSize: 11,
            outline: "none",
            padding: "0 8px",
          }}
        />
        <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", whiteSpace: "nowrap" }}>
          {visibleRows.length}/{rows.length}
        </span>
        {view === "dmx" ? (
          <>
            <ToolbarButton active={showValues} onClick={() => setShowValues((value) => !value)}>
              Value
            </ToolbarButton>
            <ToolbarButton active={showAttributes} onClick={() => setShowAttributes((value) => !value)}>
              Attribute
            </ToolbarButton>
            <ToolbarButton
              active={readout === "percent"}
              onClick={() => setReadout((current) => (current === "percent" ? "decimal" : "percent"))}
            >
              {readout === "percent" ? "Percent" : "Decimal"}
            </ToolbarButton>
          </>
        ) : null}
      </div>

      {view === "sheet" ? (
      <div
        ref={sheetScrollRef}
        onScroll={(event) => setSheetScrollTop(event.currentTarget.scrollTop)}
        style={{ minHeight: 0, overflow: "auto" }}
      >
        <table
          style={{
            width: "100%",
            minWidth: 980,
            borderCollapse: "collapse",
            fontSize: 11,
            color: "var(--lx-fg-secondary)",
          }}
        >
          <thead>
            <tr
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                height: 26,
                background: "var(--lx-bg-deep)",
                color: "var(--lx-fg-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <HeaderCell width={64}>FID</HeaderCell>
              <HeaderCell>Name</HeaderCell>
              <HeaderCell width={180}>Fixture Type</HeaderCell>
              <HeaderCell width={120}>Mode</HeaderCell>
              <HeaderCell width={88}>Patch</HeaderCell>
              <HeaderCell width={72}>Ch</HeaderCell>
              <HeaderCell width={94}>Stage</HeaderCell>
              <HeaderCell width={210}>Active Values</HeaderCell>
              <HeaderCell width={98}>State</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {virtualSheetRows.topPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={SHEET_COLUMN_COUNT} style={{ height: virtualSheetRows.topPadding, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {virtualSheetRows.rows.map((row) => (
              <FixtureSheetTableRow
                key={row.id}
                row={row}
                selected={selectedIdSet.has(row.id)}
                primary={row.id === primaryId}
                activeValues={activeValuesByRow.get(row.id) ?? []}
                onSelect={selectFixture}
                onToggleExpanded={toggleExpanded}
              />
            ))}
            {virtualSheetRows.bottomPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={SHEET_COLUMN_COUNT} style={{ height: virtualSheetRows.bottomPadding, padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </tbody>
        </table>

        {visibleRows.length === 0 && (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 120,
              color: "var(--lx-fg-tertiary)",
              fontSize: 11,
            }}
          >
            No fixtures
          </div>
        )}
      </div>
      ) : (
        <FixtureDmxView
          rows={visibleRows}
          groups={attributeGroups}
          frameByUniverse={frameByUniverse}
          selection={{ fixtureIds: selectedIds, primaryFixtureId: primaryId || null, version: 0 }}
          readout={readout}
          showValues={showValues}
          showAttributes={showAttributes}
          onSelectRow={selectFixture}
          onToggleFixture={toggleExpanded}
        />
      )}

      <div
        className="lx-code"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          borderTop: "1px solid var(--lx-stroke)",
          color: "var(--lx-fg-tertiary)",
          fontSize: 10,
        }}
      >
        <span>{status}</span>
        <span>{selectedIds.length > 0 ? `${selectedIds.length} selected` : "No selection"}</span>
      </div>
    </div>
  );
}

function buildRows(
  fixtures: PatchFixture[],
  fixtureTypes: FixtureTypeEntry[],
  expandedFixtureIds: Set<string>,
): FixtureSheetRow[] {
  const rows: FixtureSheetRow[] = [];
  for (const fixture of fixtures) {
    const mode = findModeForFixture(fixture, fixtureTypes);
    const subFixtures = mode?.subFixtures ?? [];
    const expanded = expandedFixtureIds.has(fixture.id);
    rows.push({
      id: fixture.id,
      fixture,
      mode,
      fidLabel: String(fixture.fid),
      name: fixture.name,
      patchLabel: formatPatch(fixture),
      channels: fixture.channels,
      isSubFixture: false,
      subFixtureName: "",
      subFixture: null,
      hasSubFixtures: subFixtures.length > 0,
      expanded,
    });

    if (!expanded) {
      continue;
    }

    for (const subFixture of subFixtures) {
      rows.push({
        id: `${fixture.id}::sub:${subFixture.id}`,
        fixture,
        mode,
        fidLabel: `${fixture.fid}.${subFixture.index}`,
        name: `  ${subFixture.name}`,
        patchLabel: formatSubPatch(fixture, subFixture),
        channels: subFixture.channelCount,
        isSubFixture: true,
        subFixtureName: subFixture.name,
        subFixture,
        hasSubFixtures: false,
        expanded: false,
      });
    }
  }
  return rows;
}

function findModeForFixture(fixture: PatchFixture, fixtureTypes: FixtureTypeEntry[]) {
  const fixtureType = fixtureTypes.find(
    (item) =>
      item.path === fixture.fixtureTypePath ||
      item.id === fixture.fixtureTypeId ||
      `${item.manufacturer} ${item.name}`.trim() === fixture.fixtureTypeName,
  );
  return (
    fixtureType?.modes.find((mode) => mode.id === fixture.modeId) ??
    fixtureType?.modes.find((mode) => mode.name === fixture.modeName) ??
    fixtureType?.modes.find((mode) => mode.channels === fixture.channels) ??
    fixtureType?.modes[0] ??
    null
  );
}

function getRangeFixtureIds(rows: FixtureSheetRow[], anchorId: string, targetId: string) {
  const anchorIndex = rows.findIndex((row) => row.id === anchorId);
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return rows.slice(start, end + 1).map((row) => row.id);
}

function mergeUnique(left: string[], right: string[]) {
  const merged = [...left];
  for (const item of right) {
    if (!merged.includes(item)) merged.push(item);
  }
  return merged;
}

function virtualizeRows<T>(
  rows: T[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
) {
  if (rows.length === 0) {
    return { rows: [], topPadding: 0, bottomPadding: 0 };
  }

  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, start + visibleCount + overscan * 2);
  return {
    rows: rows.slice(start, end),
    topPadding: start * rowHeight,
    bottomPadding: Math.max(0, (rows.length - end) * rowHeight),
  };
}

const FixtureSheetTableRow = memo(function FixtureSheetTableRow({
  row,
  selected,
  primary,
  activeValues,
  onSelect,
  onToggleExpanded,
}: {
  row: FixtureSheetRow;
  selected: boolean;
  primary: boolean;
  activeValues: ProgrammerValue[];
  onSelect: (event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) => void;
  onToggleExpanded: (event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) => void;
}) {
  const fixture = row.fixture;
  const active = activeValues.length > 0;

  return (
    <tr
      onClick={(event) => onSelect(event, row)}
      style={{
        height: 28,
        background: primary
          ? "rgba(240, 157, 28, 0.18)"
          : selected
            ? "rgba(77, 163, 245, 0.18)"
            : active
              ? "rgba(120, 217, 120, 0.10)"
              : "transparent",
        color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
        cursor: "pointer",
        boxShadow: active ? "inset 3px 0 0 var(--lx-action-bright)" : undefined,
      }}
    >
      <BodyCell mono>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {!row.isSubFixture && row.hasSubFixtures ? (
            <button
              type="button"
              onClick={(event) => onToggleExpanded(event, fixture.id)}
              title={row.expanded ? "Collapse sub-fixtures" : "Expand sub-fixtures"}
              style={{
                width: 14,
                height: 14,
                border: "1px solid var(--lx-stroke)",
                borderRadius: 2,
                background: row.expanded ? "rgba(77,163,245,0.18)" : "rgba(0,0,0,0.24)",
                color: "var(--lx-fg-secondary)",
                fontSize: 10,
                lineHeight: "12px",
                padding: 0,
                cursor: "pointer",
              }}
            >
              {row.expanded ? "-" : "+"}
            </button>
          ) : (
            <span style={{ width: 14 }} />
          )}
          {row.fidLabel}
        </span>
      </BodyCell>
      <BodyCell strong={!row.isSubFixture}>{row.name}</BodyCell>
      <BodyCell>{fixture.fixtureTypeName}</BodyCell>
      <BodyCell>{fixture.modeName}</BodyCell>
      <BodyCell mono>{row.patchLabel}</BodyCell>
      <BodyCell mono>{row.channels}</BodyCell>
      <BodyCell>{fixture.stage}</BodyCell>
      <BodyCell>
        <ActiveValueChips values={activeValues} />
      </BodyCell>
      <BodyCell>
        <StateBadge fixture={fixture} active={active} />
      </BodyCell>
    </tr>
  );
}, fixtureSheetRowPropsEqual);

function fixtureSheetRowPropsEqual(
  previous: {
    row: FixtureSheetRow;
    selected: boolean;
    primary: boolean;
    activeValues: ProgrammerValue[];
    onSelect: (event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) => void;
    onToggleExpanded: (event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) => void;
  },
  next: {
    row: FixtureSheetRow;
    selected: boolean;
    primary: boolean;
    activeValues: ProgrammerValue[];
    onSelect: (event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) => void;
    onToggleExpanded: (event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) => void;
  },
) {
  return (
    previous.row === next.row &&
    previous.selected === next.selected &&
    previous.primary === next.primary &&
    previous.onSelect === next.onSelect &&
    previous.onToggleExpanded === next.onToggleExpanded &&
    activeValuesSignature(previous.activeValues) === activeValuesSignature(next.activeValues)
  );
}

function FixtureDmxView({
  rows,
  groups,
  frameByUniverse,
  selection,
  readout,
  showValues,
  showAttributes,
  onSelectRow,
  onToggleFixture,
}: {
  rows: FixtureSheetRow[];
  groups: AttributeGroup[];
  frameByUniverse: Map<number, DmxUniverseFrame>;
  selection: FixtureSelection;
  readout: ReadoutMode;
  showValues: boolean;
  showAttributes: boolean;
  onSelectRow: (event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) => void;
  onToggleFixture: (event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: 120, color: "var(--lx-fg-tertiary)" }}>
        No fixture DMX attributes
      </div>
    );
  }

  return (
    <div style={{ minHeight: 0, overflow: "auto", background: "var(--lx-bg-void)" }}>
      <table
        style={{
          width: "max-content",
          minWidth: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontSize: 11,
          color: "var(--lx-fg-secondary)",
        }}
      >
        <thead>
          <tr style={dmxHeaderRowStyle}>
            <HeaderCell width={44} rowSpan={2} center />
            <HeaderCell width={190} rowSpan={2}>Name</HeaderCell>
            <HeaderCell width={72} rowSpan={2}>FID</HeaderCell>
            <HeaderCell width={92} rowSpan={2}>IDType</HeaderCell>
            <HeaderCell width={82} rowSpan={2}>Patch</HeaderCell>
            {groups.map((group) => (
              <HeaderCell key={group.name} colSpan={group.attributes.length} center>
                {group.name}
              </HeaderCell>
            ))}
          </tr>
          <tr style={dmxHeaderRowStyle}>
            {groups.flatMap((group) =>
              group.attributes.map((attribute) => (
                <HeaderCell key={`${group.name}-${attribute.name}`} width={68} center>
                  {compactAttributeName(attribute.name)}
                </HeaderCell>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = rowSelected(row.id, selection);
            return (
              <tr
                key={row.id}
                onClick={(event) => onSelectRow(event, row)}
                style={{
                  height: 30,
                  background: selected ? "rgba(77,163,245,0.18)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <BodyCell center>
                  {!row.isSubFixture && row.hasSubFixtures ? (
                    <button
                      type="button"
                      onClick={(event) => onToggleFixture(event, row.fixture.id)}
                      style={fixtureDmxExpandButtonStyle}
                    >
                      {row.expanded ? "v" : ">"}
                    </button>
                  ) : null}
                </BodyCell>
                <BodyCell strong={!row.isSubFixture}>{row.name}</BodyCell>
                <BodyCell mono>{row.fidLabel}</BodyCell>
                <BodyCell>{row.isSubFixture ? "Subfixture" : "Fixture"}</BodyCell>
                <BodyCell mono>{row.patchLabel}</BodyCell>
                {groups.flatMap((group) =>
                  group.attributes.map((attribute) => {
                    const cell = fixtureDmxCell(row, attribute, frameByUniverse, readout);
                    return (
                      <BodyCell key={`${row.id}-${group.name}-${attribute.name}`} center>
                        <DmxValueCell
                          value={showValues ? cell.value : ""}
                          attribute={showAttributes ? compactAttributeName(attribute.name) : ""}
                          source={cell.source}
                          occupied={cell.occupied}
                        />
                      </BodyCell>
                    );
                  }),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DmxValueCell({
  value,
  attribute,
  source,
  occupied,
}: {
  value: string;
  attribute: string;
  source: DmxChannelSource;
  occupied: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "8px 14px 8px",
        alignItems: "center",
        justifyItems: "center",
        minWidth: 56,
        height: 28,
        borderRadius: 2,
        color: "var(--lx-fg-primary)",
        ...sourceCellStyle(source, occupied),
      }}
    >
      <span style={{ color: sourceColor(source), fontSize: 8 }}>{sourceLabel(source)}</span>
      <strong>{value}</strong>
      <small>{attribute}</small>
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 24,
        flex: "0 0 auto",
        padding: "0 8px",
        border: active ? "1px solid rgba(240,157,28,0.62)" : "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--lx-radius-xs)",
        background: "rgba(0,0,0,0.24)",
        color: active ? "var(--lx-accent-bright)" : "var(--lx-fg-secondary)",
        fontSize: 10,
        fontWeight: 800,
      }}
    >
      {children}
    </button>
  );
}

function buildAttributeGroups(mode: FixtureTypeMode | null): AttributeGroup[] {
  const attributes = mode?.attributeDetails ?? [];
  const groups = new Map<string, FixtureModeAttribute[]>();
  for (const attribute of attributes) {
    const groupName = attribute.featureGroup || inferAttributeGroup(attribute.name);
    groups.set(groupName, [...(groups.get(groupName) ?? []), attribute]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => featureGroupIndex(left) - featureGroupIndex(right) || left.localeCompare(right))
    .map(([name, groupAttributes]) => ({ name, attributes: groupAttributes }));
}

function fixtureDmxCell(
  row: FixtureSheetRow,
  attribute: FixtureModeAttribute,
  frameByUniverse: Map<number, DmxUniverseFrame>,
  readout: ReadoutMode,
) {
  const slot = slotForRow(row, attribute);
  if (!slot || row.fixture.universe === null || row.fixture.address === null) {
    return { value: "-", source: "none" as DmxChannelSource, occupied: false };
  }
  const frame = frameByUniverse.get(row.fixture.universe) ?? null;
  const raw = readSlot(frame, row.fixture.address, slot);
  const source = readSlotSource(frame, row.fixture.address, slot);
  return {
    value: raw === null ? "-" : formatRawDmx(raw, slot.offsets.length, readout),
    source,
    occupied: raw !== null || source !== "none",
  };
}

function slotForRow(row: FixtureSheetRow, attribute: FixtureModeAttribute) {
  if (row.subFixture) {
    return (
      attribute.dmxSlots.find((slot) => slot.moduleId === row.subFixture?.id) ??
      attribute.dmxSlots.find((slot) =>
        slot.offsets.some((offset) => {
          if (row.subFixture?.firstAddress === null || row.subFixture?.firstAddress === undefined) return false;
          const start = row.subFixture.firstAddress;
          const end = start + row.subFixture.channelCount - 1;
          return offset >= start && offset <= end;
        }),
      ) ??
      null
    );
  }
  return attribute.dmxSlots.find((slot) => !slot.moduleId) ?? attribute.dmxSlots[0] ?? null;
}

function readSlot(frame: DmxUniverseFrame | null, baseAddress: number, slot: FixtureModeSlot) {
  if (!frame) return null;
  const bytes = slot.offsets
    .map((offset) => (offset > 0 ? frame.data[baseAddress + offset - 2] : null))
    .filter((value): value is number => value !== null && value !== undefined);
  if (bytes.length === 0) return null;
  return bytes.slice(0, 2).reduce((value, byte) => (value << 8) | byte, 0);
}

function readSlotSource(frame: DmxUniverseFrame | null, baseAddress: number, slot: FixtureModeSlot) {
  if (!frame) return "none" as DmxChannelSource;
  return slot.offsets.reduce<DmxChannelSource>((current, offset) => {
    if (offset <= 0) return current;
    const source = frame.sources?.[baseAddress + offset - 2] ?? "none";
    return sourceRank(source) > sourceRank(current) ? source : current;
  }, "none");
}

function formatRawDmx(raw: number, byteCount: number, readout: ReadoutMode) {
  if (readout === "decimal") return `${raw}`;
  const max = Math.pow(2, Math.max(1, byteCount) * 8) - 1;
  return `${Math.round((raw / max) * 100)}`;
}

function rowSelected(id: string, selection: FixtureSelection) {
  return selection.fixtureIds.some((item) => item === id || parentFixtureId(item) === id);
}

function inferAttributeGroup(attribute: string) {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt")) return "Position";
  if (lower.includes("gobo")) return "Gobo";
  if (lower.includes("color") || lower.includes("rgb") || lower === "r" || lower === "g" || lower === "b") return "Color";
  if (lower.includes("beam") || lower.includes("frost") || lower.includes("iris") || lower.includes("zoom")) return "Beam";
  if (lower.includes("focus")) return "Focus";
  if (lower.includes("dim") || lower.includes("shutter") || lower.includes("strobe")) return "Dimmer";
  return "Control";
}

function featureGroupIndex(group: string) {
  const index = FEATURE_ORDER.indexOf(group);
  return index === -1 ? FEATURE_ORDER.length : index;
}

function sourceRank(source: DmxChannelSource) {
  if (source === "programmer") return 4;
  if (source === "effect") return 3;
  if (source === "sequence") return 2;
  if (source === "default") return 1;
  return 0;
}

function sourceLabel(source: DmxChannelSource) {
  if (source === "programmer") return "P";
  if (source === "effect") return "E";
  if (source === "sequence") return "S";
  if (source === "default") return "D";
  return "";
}

function sourceColor(source: DmxChannelSource) {
  if (source === "programmer") return "var(--lx-accent-bright)";
  if (source === "default") return "var(--lx-action-bright)";
  if (source === "effect") return "var(--lx-status-warn)";
  if (source === "sequence") return "var(--lx-primary-bright)";
  return "var(--lx-fg-tertiary)";
}

function sourceCellStyle(source: DmxChannelSource, active: boolean): CSSProperties {
  if (source === "programmer") return { background: "rgba(240,157,28,0.17)" };
  if (source === "default") return { background: "rgba(120,217,120,0.14)" };
  if (source === "effect") return { background: "rgba(240,157,28,0.10)" };
  if (source === "sequence") return { background: "rgba(77,163,245,0.12)" };
  return { background: active ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.18)" };
}

const dmxHeaderRowStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1,
  height: 28,
  background: "var(--lx-bg-deep)",
  color: "var(--lx-fg-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const fixtureDmxExpandButtonStyle: CSSProperties = {
  width: 18,
  height: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 2,
  background: "rgba(255,255,255,0.045)",
  color: "var(--lx-fg-primary)",
  lineHeight: 1,
};

function HeaderCell({
  children,
  width,
  rowSpan,
  colSpan,
  center,
}: {
  children?: React.ReactNode;
  width?: number;
  rowSpan?: number;
  colSpan?: number;
  center?: boolean;
}) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={{
        width,
        borderBottom: "1px solid var(--lx-stroke)",
        padding: "0 8px",
        textAlign: center ? "center" : "left",
        fontWeight: 800,
      }}
    >
      {children}
    </th>
  );
}

function BodyCell({
  children,
  mono = false,
  strong = false,
  center = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  center?: boolean;
}) {
  return (
    <td
      className={mono ? "lx-code" : undefined}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.045)",
        padding: "0 8px",
        fontWeight: strong ? 750 : undefined,
        color: strong ? "var(--lx-fg-primary)" : undefined,
        textAlign: center ? "center" : "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function StateBadge({ fixture, active }: { fixture: PatchFixture; active: boolean }) {
  const patched = fixture.universe !== null && fixture.address !== null;
  const overflow = patched && fixture.address !== null && fixture.address + fixture.channels - 1 > 512;
  const label = active ? "Active" : overflow ? "Overflow" : patched ? "Patched" : "Open";
  const color = overflow
    ? "var(--lx-status-error)"
    : active
      ? "var(--lx-action-bright)"
    : patched
      ? "var(--lx-action-bright)"
      : "var(--lx-accent-bright)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 18,
        border: `1px solid ${color}`,
        borderRadius: "var(--lx-radius-xs)",
        color,
        padding: "0 6px",
        fontSize: 10,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function formatPatch(fixture: PatchFixture) {
  if (fixture.universe === null || fixture.address === null) return "-";
  return `${fixture.universe}.${String(fixture.address).padStart(3, "0")}`;
}

function formatSubPatch(fixture: PatchFixture, subFixture: FixtureModeSubFixture) {
  if (fixture.universe === null || fixture.address === null || subFixture.firstAddress === null) {
    return "-";
  }
  const address = fixture.address + subFixture.firstAddress - 1;
  return `${fixture.universe}.${String(address).padStart(3, "0")}`;
}

function parentFixtureId(id: string) {
  return id.split("::sub:")[0] ?? id;
}

function programmerActiveValuesByFixture(programmer: Programmer) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  const valuesByFixture = new Map<string, ProgrammerValue[]>();
  for (const part of buffer.parts) {
    for (const value of part.values) {
      if (value.active) {
        const values = valuesByFixture.get(value.fixtureId) ?? [];
        values.push(value);
        valuesByFixture.set(value.fixtureId, values);
      }
    }
  }
  return valuesByFixture;
}

function buildActiveValuesByRow(
  rows: FixtureSheetRow[],
  valuesByFixture: Map<string, ProgrammerValue[]>,
) {
  const valuesByRow = new Map<string, ProgrammerValue[]>();
  for (const row of rows) {
    valuesByRow.set(row.id, [...(valuesByFixture.get(row.id) ?? [])]);
  }

  for (const [id, fixtureValues] of valuesByFixture) {
    const parentId = parentFixtureId(id);
    if (parentId === id) continue;
    const parentValues = valuesByRow.get(parentId) ?? [];
    parentValues.push(...fixtureValues);
    valuesByRow.set(parentId, parentValues);
  }

  return valuesByRow;
}

function ActiveValueChips({ values }: { values: ProgrammerValue[] }) {
  if (values.length === 0) {
    return <span style={{ color: "var(--lx-fg-tertiary)" }}>-</span>;
  }

  const visible = values.slice(0, 4);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflow: "hidden" }}>
      {visible.map((value) => (
        <span
          key={`${value.fixtureId}-${value.attribute}-${value.layer}`}
          className="lx-code"
          title={`${value.fixtureId} ${value.attribute} ${formatProgrammerValue(value)} ${value.layer}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            maxWidth: 86,
            height: 18,
            border: "1px solid rgba(120,217,120,0.48)",
            borderRadius: "var(--lx-radius-xs)",
            background: "rgba(120,217,120,0.11)",
            color: "var(--lx-action-bright)",
            padding: "0 5px",
            fontSize: 9,
            fontWeight: 800,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {compactAttributeName(value.attribute)}:{formatProgrammerValue(value)}
        </span>
      ))}
      {values.length > visible.length ? (
        <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>
          +{values.length - visible.length}
        </span>
      ) : null}
    </div>
  );
}

function activeValuesSignature(values: ProgrammerValue[]) {
  return values
    .map(
      (value) =>
        `${value.fixtureId}:${value.attribute}:${value.layer}:${value.active}:${value.value.numeric ?? ""}:${value.value.text ?? ""}`,
    )
    .join("|");
}

function compactAttributeName(attribute: string) {
  return attribute
    .replace(/^ColorAdd_/i, "")
    .replace(/^Color/i, "Col")
    .replace(/^Shutter/i, "Shut")
    .replace(/^Dimmer/i, "Dim");
}

function formatProgrammerValue(value: ProgrammerValue) {
  if (value.value.text?.trim()) return value.value.text.trim();
  if (typeof value.value.numeric === "number" && Number.isFinite(value.value.numeric)) {
    if (value.layer === "fade" || value.layer === "delay") {
      return `${value.value.numeric.toFixed(1)}s`;
    }
    return Number.isInteger(value.value.numeric)
      ? String(value.value.numeric)
      : value.value.numeric.toFixed(1);
  }
  return "-";
}
