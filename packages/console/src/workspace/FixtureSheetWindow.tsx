import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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
  subFixtures?: FixtureModeSubFixture[];
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
  active: boolean;
}

interface FixtureSheetRow {
  id: string;
  fixture: PatchFixture;
  fidLabel: string;
  name: string;
  patchLabel: string;
  channels: number;
  isSubFixture: boolean;
  subFixtureName: string;
  hasSubFixtures: boolean;
  expanded: boolean;
}

export function FixtureSheetWindow() {
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Ready");
  const [expandedFixtureIds, setExpandedFixtureIds] = useState<Set<string>>(() => new Set());
  const [programmer, setProgrammer] = useState<Programmer>({
    live: { selectedPartId: 0, parts: [] },
    preview: { selectedPartId: 0, parts: [] },
    mode: "live",
    blind: false,
    version: 0,
  });

  const rows = useMemo(
    () => buildRows(fixtures, fixtureTypes, expandedFixtureIds),
    [expandedFixtureIds, fixtures, fixtureTypes],
  );
  const activeFixtureIds = useMemo(() => programmerActiveFixtureIds(programmer), [programmer]);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.fidLabel} ${row.name} ${row.subFixtureName} ${row.fixture.fixtureTypeName} ${row.fixture.modeName} ${row.patchLabel} ${row.fixture.stage}`
        .toLowerCase()
        .includes(needle),
    );
  }, [query, rows]);

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
        void loadPatch();
      });
      const fixtureTypesChanged = await listen("fixture-types:changed", () => {
        void loadFixtureTypes();
      });
      const showLoaded = await listen("show:loaded", () => {
        void loadFixtureTypes();
        void loadPatch();
      });
      const showDeleted = await listen("show:deleted", () => {
        setFixtures([]);
        setFixtureTypes([]);
        setSelectedIds([]);
        setPrimaryId("");
        setAnchorId("");
        setExpandedFixtureIds(new Set());
        setStatus("No show loaded");
      });
      const selectionChanged = await listen<FixtureSelection>(
        "fixture-selection:changed",
        (event) => {
          setSelectedIds(event.payload.fixtureIds);
          setPrimaryId(event.payload.primaryFixtureId ?? "");
        },
      );
      const programmerChanged = await listen<Programmer>("programmer:changed", (event) => {
        setProgrammer(event.payload);
      });

      if (!active) {
        patchChanged();
        fixtureTypesChanged();
        showLoaded();
        showDeleted();
        selectionChanged();
        programmerChanged();
        return;
      }
      unlisteners.push(patchChanged, fixtureTypesChanged, showLoaded, showDeleted, selectionChanged, programmerChanged);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function loadPatch() {
    try {
      const document = await invoke<PatchDocument | null>("patch_load_current_show");
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
      const types = await invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show");
      setFixtureTypes(types);
    } catch {
      setFixtureTypes([]);
    }
  }

  async function loadSelection() {
    try {
      const selection = await invoke<FixtureSelection>("fixture_selection_get");
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
      setProgrammer(await invoke<Programmer>("programmer_get"));
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

  function toggleExpanded(event: React.MouseEvent<HTMLButtonElement>, fixtureId: string) {
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
  }

  function selectFixture(event: React.MouseEvent<HTMLTableRowElement>, row: FixtureSheetRow) {
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
  }

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
      </div>

      <div style={{ minHeight: 0, overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 760,
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
              <HeaderCell width={98}>State</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const fixture = row.fixture;
              const selected = selectedIds.includes(row.id);
              const primary = row.id === primaryId;
              const active =
                activeFixtureIds.has(row.id) ||
                (!row.isSubFixture && fixtureHasActiveValues(activeFixtureIds, fixture.id));
              return (
                <tr
                  key={row.id}
                  onClick={(event) => selectFixture(event, row)}
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
                          onClick={(event) => toggleExpanded(event, fixture.id)}
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
                    <StateBadge fixture={fixture} active={active} />
                  </BodyCell>
                </tr>
              );
            })}
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
      fidLabel: String(fixture.fid),
      name: fixture.name,
      patchLabel: formatPatch(fixture),
      channels: fixture.channels,
      isSubFixture: false,
      subFixtureName: "",
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
        fidLabel: `${fixture.fid}.${subFixture.index}`,
        name: `  ${subFixture.name}`,
        patchLabel: formatSubPatch(fixture, subFixture),
        channels: subFixture.channelCount,
        isSubFixture: true,
        subFixtureName: subFixture.name,
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
    fixtureType?.modes[0]
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

function HeaderCell({ children, width }: { children: React.ReactNode; width?: number }) {
  return (
    <th
      style={{
        width,
        borderBottom: "1px solid var(--lx-stroke)",
        padding: "0 8px",
        textAlign: "left",
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
        fontWeight: strong ? 750 : undefined,
        color: strong ? "var(--lx-fg-primary)" : undefined,
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

function programmerActiveFixtureIds(programmer: Programmer) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  const ids = new Set<string>();
  for (const part of buffer.parts) {
    for (const value of part.values) {
      if (value.active) {
        ids.add(value.fixtureId);
      }
    }
  }
  return ids;
}

function fixtureHasActiveValues(activeFixtureIds: Set<string>, fixtureId: string) {
  if (activeFixtureIds.has(fixtureId)) return true;
  const prefix = `${fixtureId}::sub:`;
  for (const id of activeFixtureIds) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}
