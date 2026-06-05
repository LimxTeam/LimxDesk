import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
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

interface DmxUniverseFrame {
  universe: number;
  data: number[];
  sources?: DmxChannelSource[];
}

type DmxChannelSource = "none" | "default" | "sequence" | "effect" | "programmer";
type SheetView = "fixture" | "address";
type ReadoutMode = "percent" | "decimal";

interface FixtureRow {
  id: string;
  fixture: PatchFixture;
  mode: FixtureTypeMode | null;
  fidLabel: string;
  name: string;
  idType: "Fixture" | "Subfixture";
  subFixture: FixtureModeSubFixture | null;
  hasChildren: boolean;
  expanded: boolean;
}

interface AttributeGroup {
  name: string;
  attributes: FixtureModeAttribute[];
}

interface ChannelOwner {
  fixtureId: string;
  fixtureLabel: string;
  attribute: string;
  selected: boolean;
  first: boolean;
  last: boolean;
}

const ADDRESS_COLUMNS = 20;
const ADDRESS_ROWS = 26;
const FEATURE_ORDER = ["Dimmer", "Position", "Gobo", "Color", "Beam", "Focus", "Control", "Shapers"];

export function DmxSheetWindow() {
  const [view, setView] = useState<SheetView>("address");
  const [readout, setReadout] = useState<ReadoutMode>("decimal");
  const [onlySelection, setOnlySelection] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [showAttributes, setShowAttributes] = useState(true);
  const [showIds, setShowIds] = useState(true);
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);
  const [frames, setFrames] = useState<DmxUniverseFrame[]>([]);
  const [selectedUniverse, setSelectedUniverse] = useState<number | null>(null);
  const [selection, setSelection] = useState<FixtureSelection>({
    fixtureIds: [],
    primaryFixtureId: null,
    version: 0,
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("Ready");

  const frame = useMemo(() => {
    if (frames.length === 0) return null;
    return frames.find((item) => item.universe === selectedUniverse) ?? frames[0];
  }, [frames, selectedUniverse]);

  const rows = useMemo(
    () => buildFixtureRows(fixtures, fixtureTypes, expanded),
    [expanded, fixtureTypes, fixtures],
  );

  const referenceMode = useMemo(() => {
    const primaryId = selection.primaryFixtureId ?? selection.fixtureIds[0] ?? "";
    return (
      rows.find((row) => row.id === primaryId)?.mode ??
      rows.find((row) => row.fixture.id === parentFixtureId(primaryId))?.mode ??
      rows.find((row) => row.mode)?.mode ??
      null
    );
  }, [rows, selection.fixtureIds, selection.primaryFixtureId]);

  const attributeGroups = useMemo(() => buildAttributeGroups(referenceMode), [referenceMode]);
  const owners = useMemo(
    () => buildChannelOwners(fixtures, fixtureTypes, selection, onlySelection, frame?.universe ?? null),
    [fixtureTypes, fixtures, frame?.universe, onlySelection, selection],
  );
  const visibleRows = useMemo(
    () => (onlySelection ? rows.filter((row) => rowSelected(row.id, selection)) : rows),
    [onlySelection, rows, selection],
  );

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const events = await Promise.all([
        listen("output:sent", () => void loadFrames()),
        listen("programmer:changed", () => void loadFrames()),
        listen("patch:changed", () => {
          void loadPatch();
          void loadFrames();
        }),
        listen("fixture-types:changed", () => {
          void loadFixtureTypes();
          void loadFrames();
        }),
        listen("fixture-selection:changed", (event) => {
          setSelection(event.payload as FixtureSelection);
        }),
        listen("show:loaded", () => void reloadAll()),
        listen("show:deleted", () => {
          setFixtures([]);
          setFixtureTypes([]);
          setFrames([]);
          setSelectedUniverse(null);
          setSelection({ fixtureIds: [], primaryFixtureId: null, version: 0 });
          setExpanded(new Set());
          setStatus("No show loaded");
        }),
      ]);

      if (!active) {
        events.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...events);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function reloadAll() {
    await Promise.all([loadPatch(), loadFixtureTypes(), loadSelection(), loadFrames()]);
  }

  async function loadPatch() {
    try {
      const document = await invoke<PatchDocument | null>("patch_load_current_show");
      const nextFixtures = document?.fixtures ?? [];
      setFixtures(nextFixtures);
      setStatus(`${nextFixtures.length} fixture${nextFixtures.length === 1 ? "" : "s"}`);
    } catch {
      setFixtures([]);
      setStatus("No show loaded");
    }
  }

  async function loadFixtureTypes() {
    try {
      setFixtureTypes(await invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show"));
    } catch {
      setFixtureTypes([]);
    }
  }

  async function loadSelection() {
    try {
      setSelection(await invoke<FixtureSelection>("fixture_selection_get"));
    } catch {
      setSelection({ fixtureIds: [], primaryFixtureId: null, version: 0 });
    }
  }

  async function loadFrames() {
    try {
      const nextFrames = await invoke<DmxUniverseFrame[]>("output_render_dmx");
      nextFrames.sort((left, right) => left.universe - right.universe);
      setFrames(nextFrames);
      setSelectedUniverse((current) => {
        if (current !== null && nextFrames.some((item) => item.universe === current)) {
          return current;
        }
        return nextFrames[0]?.universe ?? null;
      });
    } catch {
      setFrames([]);
      setSelectedUniverse(null);
    }
  }

  function toggleFixture(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectRow(event: MouseEvent<HTMLTableRowElement>, row: FixtureRow) {
    const additive = event.ctrlKey || event.metaKey;
    const range = event.shiftKey && selection.primaryFixtureId;
    const fixtureIds = range ? fixtureRange(rows, selection.primaryFixtureId ?? "", row.id) : [row.id];
    const mode = range ? (additive ? "add" : "replace") : additive ? "toggle" : "replace";

    setSelection((current) => {
      if (range) {
        return {
          ...current,
          fixtureIds: mergeUnique(additive ? current.fixtureIds : [], fixtureIds),
          primaryFixtureId: row.id,
        };
      }
      if (additive) {
        return {
          ...current,
          fixtureIds: current.fixtureIds.includes(row.id)
            ? current.fixtureIds.filter((id) => id !== row.id)
            : [...current.fixtureIds, row.id],
          primaryFixtureId: row.id,
        };
      }
      return { ...current, fixtureIds, primaryFixtureId: row.id };
    });

    void invoke("fixture_selection_select", {
      fixtureIds,
      primaryFixtureId: row.id,
      mode,
    });
  }

  const activeChannels = frame?.data.filter((value) => value > 0).length ?? 0;

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <div style={styles.titleBlock}>
          <span style={styles.badge}>MA</span>
          <strong style={styles.title}>{view === "fixture" ? "Fixture: DMX" : "DMX"}</strong>
        </div>

        <div style={styles.segment}>
          <ToolButton active={view === "fixture"} onClick={() => setView("fixture")}>
            Fixture: DMX
          </ToolButton>
          <ToolButton active={view === "address"} onClick={() => setView("address")}>
            DMX
          </ToolButton>
        </div>

        <div style={styles.toolbarSpacer} />

        <ToolButton
          active={onlySelection}
          onClick={() => setOnlySelection((value) => !value)}
        >
          Only Selection
        </ToolButton>
        <ToolButton
          active={showValues}
          onClick={() => setShowValues((value) => !value)}
        >
          Value
        </ToolButton>
        <ToolButton
          active={showAttributes}
          onClick={() => setShowAttributes((value) => !value)}
        >
          Attribute
        </ToolButton>
        <ToolButton active={showIds} onClick={() => setShowIds((value) => !value)}>
          ID
        </ToolButton>
        <ToolButton
          active={readout === "percent"}
          onClick={() => setReadout((current) => (current === "percent" ? "decimal" : "percent"))}
        >
          {readout === "percent" ? "Percent" : "Decimal"}
        </ToolButton>
        <StepButton onClick={() => setSelectedUniverse(stepUniverse(frames, selectedUniverse, -1))}>
          {"<"}
        </StepButton>
        <span style={styles.universePill}>{selectedUniverse ?? "-"}</span>
        <StepButton onClick={() => setSelectedUniverse(stepUniverse(frames, selectedUniverse, 1))}>
          {">"}
        </StepButton>
      </div>

      <div style={styles.content}>
        {view === "fixture" ? (
          <FixtureDmxView
            rows={visibleRows}
            groups={attributeGroups}
            frame={frame}
            readout={readout}
            selection={selection}
            showValues={showValues}
            showAttributes={showAttributes}
            onSelectRow={selectRow}
            onToggleFixture={toggleFixture}
          />
        ) : (
          <AddressDmxView
            frame={frame}
            owners={owners}
            readout={readout}
            showValues={showValues}
            showAttributes={showAttributes}
            showIds={showIds}
          />
        )}
      </div>

      <div style={styles.status}>
        <span>{status}</span>
        <span>
          {frame ? `Universe ${frame.universe}  ${activeChannels}/512 active` : "No rendered DMX"}
        </span>
      </div>
    </div>
  );
}

function FixtureDmxView({
  rows,
  groups,
  frame,
  readout,
  selection,
  showValues,
  showAttributes,
  onSelectRow,
  onToggleFixture,
}: {
  rows: FixtureRow[];
  groups: AttributeGroup[];
  frame: DmxUniverseFrame | null;
  readout: ReadoutMode;
  selection: FixtureSelection;
  showValues: boolean;
  showAttributes: boolean;
  onSelectRow: (event: MouseEvent<HTMLTableRowElement>, row: FixtureRow) => void;
  onToggleFixture: (id: string) => void;
}) {
  if (groups.length === 0) {
    return <EmptyState label="No fixture DMX attributes" />;
  }

  return (
    <div style={styles.tableViewport}>
      <table style={styles.fixtureTable}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <HeaderCell width={42} rowSpan={2} />
            <HeaderCell width={180} rowSpan={2}>Name</HeaderCell>
            <HeaderCell width={72} rowSpan={2}>FID</HeaderCell>
            <HeaderCell width={92} rowSpan={2}>IDType</HeaderCell>
            <HeaderCell width={72} rowSpan={2}>Patch</HeaderCell>
            {groups.map((group) => (
              <HeaderCell key={group.name} colSpan={group.attributes.length} center>
                {group.name}
              </HeaderCell>
            ))}
          </tr>
          <tr style={styles.tableHeaderRow}>
            {groups.flatMap((group) =>
              group.attributes.map((attribute) => (
                <HeaderCell key={`${group.name}-${attribute.name}`} width={68} center>
                  {compactAttribute(attribute.name)}
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
                  ...styles.bodyRow,
                  background: selected ? "rgba(77,163,245,0.18)" : undefined,
                }}
              >
                <BodyCell center>
                  {row.hasChildren ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleFixture(row.fixture.id);
                      }}
                      style={styles.expandButton}
                    >
                      {row.expanded ? "v" : ">"}
                    </button>
                  ) : null}
                </BodyCell>
                <BodyCell strong={!row.subFixture}>{row.name}</BodyCell>
                <BodyCell mono>{row.fidLabel}</BodyCell>
                <BodyCell>{row.idType}</BodyCell>
                <BodyCell mono>{patchLabel(row.fixture, row.subFixture)}</BodyCell>
                {groups.flatMap((group) =>
                  group.attributes.map((attribute) => {
                    const cell = fixtureCell(row, attribute, frame, readout);
                    return (
                      <BodyCell key={`${row.id}-${group.name}-${attribute.name}`} center>
                        <DmxValueCell
                          value={showValues ? cell.value : ""}
                          attribute={showAttributes ? compactAttribute(attribute.name) : ""}
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

function AddressDmxView({
  frame,
  owners,
  readout,
  showValues,
  showAttributes,
  showIds,
}: {
  frame: DmxUniverseFrame | null;
  owners: Map<number, ChannelOwner>;
  readout: ReadoutMode;
  showValues: boolean;
  showAttributes: boolean;
  showIds: boolean;
}) {
  if (!frame) {
    return <EmptyState label="No rendered DMX frame" />;
  }

  const cells = Array.from({ length: ADDRESS_ROWS * ADDRESS_COLUMNS }, (_, index) => {
    if (index >= 512) {
      return {
        index,
        valid: false,
        owner: undefined,
        value: 0,
        displayValue: "",
        source: "none" as DmxChannelSource,
      };
    }
    const owner = owners.get(index);
    const value = frame.data[index] ?? 0;
    return {
      index,
      valid: true,
      owner,
      value,
      displayValue: readout === "percent" ? `${Math.round((value / 255) * 100)}` : `${value}`,
      source: frame.sources?.[index] ?? "none",
    };
  });

  return (
    <div style={styles.addressViewport}>
      <div style={styles.addressGrid}>
        <div style={styles.addressCorner}>Attrib.</div>
        {Array.from({ length: ADDRESS_COLUMNS }, (_, column) => (
          <div key={`head-${column}`} style={styles.addressHead}>
            {column + 1}
          </div>
        ))}
        {Array.from({ length: ADDRESS_ROWS }, (_, rowIndex) => {
          const start = rowIndex * ADDRESS_COLUMNS;
          return (
            <AddressRow
              key={`row-${rowIndex}`}
              start={start}
              universe={frame.universe}
              cells={cells.slice(start, start + ADDRESS_COLUMNS)}
              showValues={showValues}
              showAttributes={showAttributes}
              showIds={showIds}
            />
          );
        })}
      </div>
    </div>
  );
}

function AddressRow({
  start,
  universe,
  cells,
  showValues,
  showAttributes,
  showIds,
}: {
  start: number;
  universe: number;
  cells: Array<{
    index: number;
    valid: boolean;
    owner: ChannelOwner | undefined;
    value: number;
    displayValue: string;
    source: DmxChannelSource;
  }>;
  showValues: boolean;
  showAttributes: boolean;
  showIds: boolean;
}) {
  return (
    <>
      <div style={styles.addressRowLabel}>
        <span>Attrib.</span>
        <strong>{`${universe}.${String(start + 1).padStart(3, "0")}`}</strong>
      </div>
      {cells.map((cell) => (
        <div
          key={cell.index}
          title={
            cell.valid
              ? `${universe}.${String(cell.index + 1).padStart(3, "0")} ${cell.owner?.fixtureLabel ?? ""} ${cell.owner?.attribute ?? ""}`
              : ""
          }
          style={{
            ...styles.addressCell,
            ...sourceCellStyle(cell.source, cell.value > 0),
            borderColor: cell.owner?.selected ? "rgba(245,184,77,0.95)" : "rgba(255,255,255,0.045)",
            opacity: cell.valid ? 1 : 0.18,
          }}
        >
          <div style={styles.addressCellTop}>
            <span>{cell.valid ? cell.index + 1 : ""}</span>
            <span style={{ color: sourceColor(cell.source) }}>{sourceLabel(cell.source)}</span>
          </div>
          <div style={styles.addressCellValue}>{showValues ? cell.displayValue : ""}</div>
          <div style={styles.addressCellMeta}>
            <span>{showAttributes ? compactAttribute(cell.owner?.attribute ?? "") : ""}</span>
            <span>{showIds ? cell.owner?.fixtureLabel ?? "" : ""}</span>
          </div>
        </div>
      ))}
    </>
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
        ...styles.valueCell,
        ...sourceCellStyle(source, occupied),
      }}
    >
      <span style={{ color: sourceColor(source), fontSize: 8 }}>{sourceLabel(source)}</span>
      <strong>{value}</strong>
      <small>{attribute}</small>
    </div>
  );
}

function ToolButton({
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
        ...styles.toolButton,
        borderColor: active ? "rgba(240,157,28,0.62)" : "rgba(255,255,255,0.08)",
        color: active ? "var(--lx-accent-bright)" : "var(--lx-fg-secondary)",
      }}
    >
      {children}
    </button>
  );
}

function StepButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={styles.stepButton}>
      {children}
    </button>
  );
}

function HeaderCell({
  children,
  width,
  rowSpan,
  colSpan,
  center,
}: {
  children?: ReactNode;
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
        ...styles.headerCell,
        width,
        textAlign: center ? "center" : "left",
      }}
    >
      {children}
    </th>
  );
}

function BodyCell({
  children,
  mono,
  strong,
  center,
}: {
  children?: ReactNode;
  mono?: boolean;
  strong?: boolean;
  center?: boolean;
}) {
  return (
    <td
      className={mono ? "lx-code" : undefined}
      style={{
        ...styles.bodyCell,
        textAlign: center ? "center" : "left",
        fontWeight: strong ? 800 : undefined,
        color: strong ? "var(--lx-fg-primary)" : undefined,
      }}
    >
      {children}
    </td>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div style={styles.empty}>{label}</div>;
}

function buildFixtureRows(
  fixtures: PatchFixture[],
  fixtureTypes: FixtureTypeEntry[],
  expanded: Set<string>,
) {
  const rows: FixtureRow[] = [];
  for (const fixture of fixtures) {
    const mode = findMode(fixture, fixtureTypes);
    const subFixtures = mode?.subFixtures ?? [];
    const isExpanded = expanded.has(fixture.id);
    rows.push({
      id: fixture.id,
      fixture,
      mode,
      fidLabel: `${fixture.fid}`,
      name: fixture.name,
      idType: "Fixture",
      subFixture: null,
      hasChildren: subFixtures.length > 0,
      expanded: isExpanded,
    });

    if (!isExpanded) continue;

    for (const subFixture of subFixtures) {
      rows.push({
        id: `${fixture.id}::sub:${subFixture.id}`,
        fixture,
        mode,
        fidLabel: `${fixture.fid}.${subFixture.index}`,
        name: `  ${subFixture.name}`,
        idType: "Subfixture",
        subFixture,
        hasChildren: false,
        expanded: false,
      });
    }
  }
  return rows;
}

function buildAttributeGroups(mode: FixtureTypeMode | null) {
  const attributes = mode?.attributeDetails ?? [];
  const groups = new Map<string, FixtureModeAttribute[]>();
  for (const attribute of attributes) {
    const groupName = attribute.featureGroup || inferGroup(attribute.name);
    groups.set(groupName, [...(groups.get(groupName) ?? []), attribute]);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => featureIndex(left) - featureIndex(right) || left.localeCompare(right))
    .map(([name, groupAttributes]) => ({ name, attributes: groupAttributes }));
}

function buildChannelOwners(
  fixtures: PatchFixture[],
  fixtureTypes: FixtureTypeEntry[],
  selection: FixtureSelection,
  onlySelection: boolean,
  universe: number | null,
) {
  const owners = new Map<number, ChannelOwner>();
  if (universe === null) return owners;

  for (const fixture of fixtures) {
    if (fixture.universe !== universe || fixture.address === null) continue;
    const mode = findMode(fixture, fixtureTypes);
    for (const attribute of mode?.attributeDetails ?? []) {
      for (const slot of attribute.dmxSlots) {
        const subFixture = subFixtureForSlot(mode, slot);
        const ownerId = subFixture ? `${fixture.id}::sub:${subFixture.id}` : fixture.id;
        const selected = rowSelected(ownerId, selection) || rowSelected(fixture.id, selection);
        if (onlySelection && !selected) continue;
        const offsets = slot.offsets.filter((offset) => offset > 0);
        offsets.forEach((offset, offsetIndex) => {
          const index = fixture.address! + offset - 2;
          if (index < 0 || index >= 512) return;
          owners.set(index, {
            fixtureId: ownerId,
            fixtureLabel: subFixture ? `${fixture.fid}.${subFixture.index}` : `${fixture.fid}`,
            attribute: attribute.name,
            selected,
            first: offsetIndex === 0,
            last: offsetIndex === offsets.length - 1,
          });
        });
      }
    }
  }
  return owners;
}

function subFixtureForSlot(mode: FixtureTypeMode | null, slot: FixtureModeSlot) {
  const subFixtures = mode?.subFixtures ?? [];
  if (slot.moduleId) {
    return subFixtures.find((item) => item.id === slot.moduleId) ?? null;
  }

  const firstOffset = slot.offsets.find((offset) => offset > 0);
  if (!firstOffset) return null;
  return (
    subFixtures.find((item) => {
      if (item.firstAddress === null) return false;
      const last = item.firstAddress + item.channelCount - 1;
      return firstOffset >= item.firstAddress && firstOffset <= last;
    }) ?? null
  );
}

function fixtureCell(
  row: FixtureRow,
  attribute: FixtureModeAttribute,
  frame: DmxUniverseFrame | null,
  readout: ReadoutMode,
) {
  const slot = slotForRow(row, attribute);
  if (!slot || row.fixture.universe === null || row.fixture.address === null) {
    return { value: "-", source: "none" as DmxChannelSource, occupied: false };
  }
  const raw = readSlot(frame, row.fixture.universe, row.fixture.address, slot);
  const source = readSlotSource(frame, row.fixture.universe, row.fixture.address, slot);
  return {
    value: raw === null ? "-" : formatRaw(raw, slot.offsets.length, readout),
    source,
    occupied: raw !== null || source !== "none",
  };
}

function slotForRow(row: FixtureRow, attribute: FixtureModeAttribute) {
  if (row.subFixture) {
    return (
      attribute.dmxSlots.find((slot) => slot.moduleId === row.subFixture?.id) ??
      attribute.dmxSlots.find((slot) => slot.offsets.some((offset) => {
        if (row.subFixture?.firstAddress === null || row.subFixture?.firstAddress === undefined) return false;
        const start = row.subFixture.firstAddress;
        const end = start + row.subFixture.channelCount - 1;
        return offset >= start && offset <= end;
      })) ??
      null
    );
  }
  return attribute.dmxSlots.find((slot) => !slot.moduleId) ?? attribute.dmxSlots[0] ?? null;
}

function readSlot(
  frame: DmxUniverseFrame | null,
  universe: number,
  baseAddress: number,
  slot: FixtureModeSlot,
) {
  if (!frame || frame.universe !== universe) return null;
  const bytes = slot.offsets
    .map((offset) => (offset > 0 ? frame.data[baseAddress + offset - 2] : null))
    .filter((value): value is number => value !== null && value !== undefined);
  if (bytes.length === 0) return null;
  return bytes.slice(0, 2).reduce((value, byte) => (value << 8) | byte, 0);
}

function readSlotSource(
  frame: DmxUniverseFrame | null,
  universe: number,
  baseAddress: number,
  slot: FixtureModeSlot,
) {
  if (!frame || frame.universe !== universe) return "none" as DmxChannelSource;
  return slot.offsets.reduce<DmxChannelSource>((current, offset) => {
    if (offset <= 0) return current;
    const source = frame.sources?.[baseAddress + offset - 2] ?? "none";
    return sourceRank(source) > sourceRank(current) ? source : current;
  }, "none");
}

function formatRaw(raw: number, byteCount: number, readout: ReadoutMode) {
  if (readout === "decimal") return `${raw}`;
  const max = Math.pow(2, Math.max(1, byteCount) * 8) - 1;
  return `${Math.round((raw / max) * 100)}`;
}

function findMode(fixture: PatchFixture, fixtureTypes: FixtureTypeEntry[]) {
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

function patchLabel(fixture: PatchFixture, subFixture: FixtureModeSubFixture | null) {
  if (fixture.universe === null || fixture.address === null) return "-";
  const address = subFixture?.firstAddress
    ? fixture.address + subFixture.firstAddress - 1
    : fixture.address;
  return `${fixture.universe}.${String(address).padStart(3, "0")}`;
}

function rowSelected(id: string, selection: FixtureSelection) {
  return selection.fixtureIds.some((item) => item === id || parentFixtureId(item) === id);
}

function fixtureRange(rows: FixtureRow[], anchorId: string, targetId: string) {
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

function parentFixtureId(id: string) {
  return id.split("::sub:")[0] ?? id;
}

function compactAttribute(attribute: string) {
  return attribute
    .replace(/^ColorAdd_/i, "")
    .replace(/^Color/i, "Col")
    .replace(/^Shutter/i, "Sh")
    .replace(/^Dimmer/i, "Dim");
}

function inferGroup(attribute: string) {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt")) return "Position";
  if (lower.includes("gobo")) return "Gobo";
  if (lower.includes("color") || lower.includes("rgb") || lower === "r" || lower === "g" || lower === "b") return "Color";
  if (lower.includes("beam") || lower.includes("frost") || lower.includes("iris") || lower.includes("zoom")) return "Beam";
  if (lower.includes("focus")) return "Focus";
  if (lower.includes("dim") || lower.includes("shutter") || lower.includes("strobe")) return "Dimmer";
  return "Control";
}

function featureIndex(group: string) {
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

function stepUniverse(frames: DmxUniverseFrame[], current: number | null, direction: number) {
  if (frames.length === 0) return null;
  const currentIndex = frames.findIndex((frame) => frame.universe === current);
  const index = currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex + direction, 0), frames.length - 1);
  return frames[index]?.universe ?? null;
}

const styles = {
  root: {
    display: "grid",
    height: "100%",
    minHeight: 0,
    gridTemplateRows: "38px minmax(0, 1fr) 24px",
    background: "var(--lx-bg-abyss)",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    padding: "0 8px",
    borderBottom: "1px solid var(--lx-stroke)",
    background: "rgba(255,255,255,0.035)",
    overflowX: "auto",
  },
  titleBlock: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flex: "0 0 auto",
  },
  badge: {
    display: "grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: 3,
    background: "rgba(240,157,28,0.16)",
    color: "var(--lx-accent-bright)",
    fontWeight: 900,
  },
  title: {
    color: "var(--lx-fg-primary)",
    fontSize: 15,
    whiteSpace: "nowrap",
  },
  segment: {
    display: "inline-flex",
    gap: 4,
    flex: "0 0 auto",
  },
  toolbarSpacer: {
    flex: "1 1 auto",
  },
  toolButton: {
    height: 26,
    flex: "0 0 auto",
    padding: "0 9px",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-xs)",
    background: "rgba(0,0,0,0.24)",
    fontSize: 11,
    fontWeight: 800,
  },
  stepButton: {
    width: 28,
    height: 26,
    flex: "0 0 auto",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-xs)",
    background: "rgba(0,0,0,0.24)",
    color: "var(--lx-fg-primary)",
    fontWeight: 900,
  },
  universePill: {
    display: "grid",
    placeItems: "center",
    minWidth: 38,
    height: 26,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-xs)",
    color: "var(--lx-fg-primary)",
    fontWeight: 900,
  },
  content: {
    minHeight: 0,
    overflow: "hidden",
  },
  tableViewport: {
    minHeight: 0,
    height: "100%",
    overflow: "auto",
    background: "var(--lx-bg-void)",
  },
  fixtureTable: {
    width: "max-content",
    minWidth: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: 11,
  },
  tableHeaderRow: {
    height: 28,
    background: "var(--lx-bg-deep)",
  },
  headerCell: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    height: 28,
    padding: "0 8px",
    border: "1px solid rgba(255,255,255,0.06)",
    background: "var(--lx-bg-deep)",
    color: "var(--lx-fg-secondary)",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  bodyRow: {
    height: 30,
    color: "var(--lx-fg-secondary)",
    cursor: "pointer",
  },
  bodyCell: {
    height: 30,
    padding: "0 8px",
    border: "1px solid rgba(255,255,255,0.045)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  expandButton: {
    width: 18,
    height: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 2,
    background: "rgba(255,255,255,0.045)",
    color: "var(--lx-fg-primary)",
    lineHeight: 1,
  },
  valueCell: {
    display: "grid",
    gridTemplateRows: "8px 14px 8px",
    alignItems: "center",
    justifyItems: "center",
    minWidth: 56,
    height: 28,
    borderRadius: 2,
    color: "var(--lx-fg-primary)",
  },
  addressViewport: {
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    background: "var(--lx-bg-void)",
    padding: 8,
  },
  addressGrid: {
    display: "grid",
    gridTemplateColumns: `112px repeat(${ADDRESS_COLUMNS}, 74px)`,
    gridAutoRows: "44px",
    gap: 2,
    minWidth: 112 + ADDRESS_COLUMNS * 76,
    alignContent: "start",
  },
  addressCorner: {
    display: "grid",
    placeItems: "center",
    color: "var(--lx-status-error)",
    fontWeight: 900,
    background: "var(--lx-bg-deep)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  addressHead: {
    display: "grid",
    placeItems: "center",
    background: "var(--lx-bg-deep)",
    color: "var(--lx-fg-secondary)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontWeight: 800,
  },
  addressRowLabel: {
    display: "grid",
    gridTemplateRows: "1fr 1fr",
    alignItems: "center",
    padding: "0 8px",
    background: "var(--lx-bg-deep)",
    color: "var(--lx-status-error)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontSize: 11,
  },
  addressCell: {
    display: "grid",
    gridTemplateRows: "11px 1fr 12px",
    minWidth: 72,
    height: 44,
    padding: "2px 4px",
    border: "1px solid rgba(255,255,255,0.045)",
    color: "var(--lx-fg-primary)",
    overflow: "hidden",
    fontVariantNumeric: "tabular-nums",
  },
  addressCellTop: {
    display: "flex",
    justifyContent: "space-between",
    color: "var(--lx-fg-tertiary)",
    fontSize: 8,
  },
  addressCellValue: {
    display: "grid",
    placeItems: "center",
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1,
  },
  addressCellMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: 4,
    color: "var(--lx-fg-tertiary)",
    fontSize: 8,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  status: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 8px",
    borderTop: "1px solid var(--lx-stroke)",
    color: "var(--lx-fg-tertiary)",
    fontSize: 10,
  },
  empty: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    minHeight: 160,
    color: "var(--lx-fg-tertiary)",
    background: "rgba(0,0,0,0.18)",
  },
} satisfies Record<string, CSSProperties>;
