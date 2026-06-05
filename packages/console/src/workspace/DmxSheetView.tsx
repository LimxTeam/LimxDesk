import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  index: number;
  firstAddress: number | null;
  channelCount: number;
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

interface ChannelOwner {
  fixtureId: string;
  fixtureLabel: string;
  attribute: string;
  selected: boolean;
}

type DmxChannelSource = "none" | "default" | "sequence" | "effect" | "programmer";
type ReadoutMode = "decimal" | "percent";

const ADDRESS_COLUMNS = 32;
const ADDRESS_ROWS = 16;

export function DmxSheetWindow() {
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
  const [status, setStatus] = useState("Ready");

  const frame = useMemo(() => {
    if (frames.length === 0) return null;
    return frames.find((item) => item.universe === selectedUniverse) ?? frames[0];
  }, [frames, selectedUniverse]);

  const owners = useMemo(
    () => buildChannelOwners(fixtures, fixtureTypes, selection, onlySelection, frame?.universe ?? null),
    [fixtureTypes, fixtures, frame?.universe, onlySelection, selection],
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

  const activeChannels = frame?.data.filter((value) => value > 0).length ?? 0;

  return (
    <div style={styles.root}>
      <div style={styles.toolbar}>
        <div style={styles.titleBlock}>
          <span style={styles.badge}>MA</span>
          <strong style={styles.title}>DMX</strong>
        </div>
        <div style={styles.toolbarSpacer} />
        <ToolButton active={onlySelection} onClick={() => setOnlySelection((value) => !value)}>
          Only Selection
        </ToolButton>
        <ToolButton active={showValues} onClick={() => setShowValues((value) => !value)}>
          Value
        </ToolButton>
        <ToolButton active={showAttributes} onClick={() => setShowAttributes((value) => !value)}>
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
        <AddressDmxView
          frame={frame}
          owners={owners}
          readout={readout}
          showValues={showValues}
          showAttributes={showAttributes}
          showIds={showIds}
        />
      </div>

      <div style={styles.status}>
        <span>{status}</span>
        <span>{frame ? `Universe ${frame.universe}  ${activeChannels}/512 active` : "No rendered DMX"}</span>
      </div>
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
    const value = frame.data[index] ?? 0;
    return {
      index,
      valid: true,
      owner: owners.get(index),
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
      {cells.map((cell) => {
        const detail = [showAttributes ? compactAttribute(cell.owner?.attribute ?? "") : "", showIds ? cell.owner?.fixtureLabel ?? "" : ""]
          .filter(Boolean)
          .join(" ");
        return (
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
            <div style={styles.addressCellValue}>{showValues ? cell.displayValue : detail}</div>
          </div>
        );
      })}
    </>
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

function EmptyState({ label }: { label: string }) {
  return <div style={styles.empty}>{label}</div>;
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
        const selected = selection.fixtureIds.some(
          (id) => id === ownerId || id === fixture.id || parentFixtureId(id) === fixture.id,
        );
        if (onlySelection && !selected) continue;
        const offsets = slot.offsets.filter((offset) => offset > 0);
        offsets.forEach((offset) => {
          const index = fixture.address! + offset - 2;
          if (index < 0 || index >= 512) return;
          owners.set(index, {
            fixtureId: ownerId,
            fixtureLabel: subFixture ? `${fixture.fid}.${subFixture.index}` : `${fixture.fid}`,
            attribute: attribute.name,
            selected,
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
  addressViewport: {
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    background: "var(--lx-bg-void)",
    padding: 8,
  },
  addressGrid: {
    display: "grid",
    gridTemplateColumns: `86px repeat(${ADDRESS_COLUMNS}, 48px)`,
    gridAutoRows: "26px",
    gap: 1,
    minWidth: 86 + ADDRESS_COLUMNS * 49,
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
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    padding: "0 5px",
    background: "var(--lx-bg-deep)",
    color: "var(--lx-status-error)",
    border: "1px solid rgba(255,255,255,0.06)",
    fontSize: 10,
  },
  addressCell: {
    display: "grid",
    gridTemplateRows: "9px 1fr",
    minWidth: 46,
    height: 26,
    padding: "1px 3px",
    border: "1px solid rgba(255,255,255,0.045)",
    color: "var(--lx-fg-primary)",
    overflow: "hidden",
    fontVariantNumeric: "tabular-nums",
  },
  addressCellTop: {
    display: "flex",
    justifyContent: "space-between",
    color: "var(--lx-fg-tertiary)",
    fontSize: 7,
  },
  addressCellValue: {
    display: "grid",
    placeItems: "center",
    fontSize: 12,
    fontWeight: 900,
    lineHeight: 1,
  },
  addressCellMeta: {
    display: "none",
    justifyContent: "space-between",
    gap: 2,
    color: "var(--lx-fg-tertiary)",
    fontSize: 7,
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
