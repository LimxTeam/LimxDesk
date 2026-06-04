import { useDeferredValue, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";

type PatchState = "patched" | "overlap" | "unpatched";

interface PatchFixture {
  id: string;
  fid: string;
  name: string;
  fixtureType: string;
  mode: string;
  patch: string;
  stage: string;
  panInvert: boolean;
  tiltInvert: boolean;
}

const STAGES = ["Main", "Stage B", "Previs"];
const FIXTURE_TYPES = ["Ayrton Diablo S", "Robe Pointe", "GLP X4 Bar 20", "Generic Dimmer"];
const MODE_OPTIONS: Record<string, string[]> = {
  "Ayrton Diablo S": ["Standard 38ch", "Extended 54ch", "Compact 24ch"],
  "Robe Pointe": ["Mode 1 24ch", "Mode 2 30ch"],
  "GLP X4 Bar 20": ["Basic 44ch", "Pixel 88ch"],
  "Generic Dimmer": ["Dimmer 1ch"],
};

const INITIAL_FIXTURES: PatchFixture[] = [
  {
    id: "fix-1",
    fid: "1",
    name: "Wash Truss L",
    fixtureType: "Ayrton Diablo S",
    mode: "Standard 38ch",
    patch: "1.001",
    stage: "Main",
    panInvert: false,
    tiltInvert: false,
  },
  {
    id: "fix-2",
    fid: "2",
    name: "Wash Truss R",
    fixtureType: "Ayrton Diablo S",
    mode: "Standard 38ch",
    patch: "1.039",
    stage: "Main",
    panInvert: true,
    tiltInvert: false,
  },
  {
    id: "fix-11",
    fid: "11",
    name: "Beam Upstage",
    fixtureType: "Robe Pointe",
    mode: "Mode 2 30ch",
    patch: "2.001",
    stage: "Main",
    panInvert: false,
    tiltInvert: true,
  },
  {
    id: "fix-12",
    fid: "12",
    name: "Beam Upstage Mirror",
    fixtureType: "Robe Pointe",
    mode: "Mode 2 30ch",
    patch: "2.001",
    stage: "Main",
    panInvert: false,
    tiltInvert: false,
  },
  {
    id: "fix-31",
    fid: "31",
    name: "Pixel Bar DS",
    fixtureType: "GLP X4 Bar 20",
    mode: "Pixel 88ch",
    patch: "-",
    stage: "Stage B",
    panInvert: false,
    tiltInvert: false,
  },
];

export function ConnectivitySettingsPage() {
  const [fixtures, setFixtures] = useState(INITIAL_FIXTURES);
  const [selectedId, setSelectedId] = useState(INITIAL_FIXTURES[0]?.id ?? "");
  const [stageFilter, setStageFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [logLine, setLogLine] = useState("Ready");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedId) ?? fixtures[0];
  const visibleFixtures = fixtures.filter((fixture) => {
    const matchesStage = stageFilter === "All" || fixture.stage === stageFilter;
    const haystack = `${fixture.fid} ${fixture.name} ${fixture.fixtureType} ${fixture.mode} ${fixture.patch}`.toLowerCase();
    return matchesStage && haystack.includes(deferredQuery);
  });
  const stats = getPatchStats(fixtures);
  const universes = getUniverseStats(fixtures);

  const updateSelected = (patch: Partial<PatchFixture>) => {
    if (!selectedFixture) {
      return;
    }

    setFixtures((current) =>
      current.map((fixture) =>
        fixture.id === selectedFixture.id ? normalizeFixture({ ...fixture, ...patch }) : fixture,
      ),
    );
  };

  const addFixture = () => {
    const nextIndex = getNextFid(fixtures);
    const fixture: PatchFixture = {
      id: `fix-${Date.now()}`,
      fid: String(nextIndex),
      name: `New Fixture ${nextIndex}`,
      fixtureType: "Generic Dimmer",
      mode: "Dimmer 1ch",
      patch: "-",
      stage: stageFilter === "All" ? "Main" : stageFilter,
      panInvert: false,
      tiltInvert: false,
    };

    setFixtures((current) => [...current, fixture]);
    setSelectedId(fixture.id);
    setLogLine(`Added fixture ${fixture.fid}`);
  };

  const duplicateFixture = () => {
    if (!selectedFixture) {
      return;
    }

    const nextIndex = getNextFid(fixtures);
    const fixture = {
      ...selectedFixture,
      id: `fix-${Date.now()}`,
      fid: String(nextIndex),
      name: `${selectedFixture.name} Copy`,
      patch: "-",
    };

    setFixtures((current) => [...current, fixture]);
    setSelectedId(fixture.id);
    setLogLine(`Duplicated fixture ${selectedFixture.fid}`);
  };

  const deleteFixture = () => {
    if (!selectedFixture) {
      return;
    }

    setFixtures((current) => {
      const next = current.filter((fixture) => fixture.id !== selectedFixture.id);
      setSelectedId(next[0]?.id ?? "");
      return next;
    });
    setLogLine(`Deleted fixture ${selectedFixture.fid}`);
  };

  const autoPatch = () => {
    let cursor = 1;
    setFixtures((current) =>
      current.map((fixture) => {
        if (fixture.patch !== "-") {
          return fixture;
        }

        while (current.some((item) => item.patch === `3.${String(cursor).padStart(3, "0")}`)) {
          cursor += 16;
        }

        const patch = `3.${String(cursor).padStart(3, "0")}`;
        cursor += getModeChannels(fixture.mode);
        return { ...fixture, patch };
      }),
    );
    setLogLine("Auto patched unassigned fixtures to Universe 3");
  };

  return (
    <div
      style={{
        display: "grid",
        minHeight: 0,
        height: "100%",
        gridTemplateRows: "auto minmax(0, 1fr) 116px",
        gap: 10,
      }}
    >
      <div
        className="lx-panel"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 1fr) auto",
          gap: 10,
          alignItems: "center",
          padding: 10,
        }}
      >
        <SearchBox value={query} onChange={setQuery} />
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="lx-btn lx-btn-primary" onClick={addFixture}>
            <Plus size={13} />
            添加灯具
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={duplicateFixture} disabled={!selectedFixture}>
            <Copy size={13} />
            复制
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={autoPatch}>
            <WandSparkles size={13} />
            自动配接
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={deleteFixture} disabled={!selectedFixture}>
            <Trash2 size={13} />
            删除
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          minHeight: 0,
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 10,
        }}
      >
        <PatchTable
          fixtures={visibleFixtures}
          allFixtures={fixtures}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Inspector fixture={selectedFixture} onChange={updateSelected} />
      </div>

      <div
        style={{
          display: "grid",
          minHeight: 0,
          gridTemplateColumns: "260px minmax(0, 1fr) 260px",
          gap: 10,
        }}
      >
        <StageFilter value={stageFilter} onChange={setStageFilter} stats={stats} />
        <UniverseStrip universes={universes} />
        <StatusPanel stats={stats} logLine={logLine} />
      </div>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        height: 30,
        alignItems: "center",
        gap: 8,
        border: "1px solid var(--lx-stroke-strong)",
        borderRadius: "var(--lx-radius-sm)",
        background: "rgba(0,0,0,0.24)",
        padding: "0 9px",
        color: "var(--lx-fg-tertiary)",
      }}
    >
      <Search size={14} />
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="搜索 FID、灯具名、地址、灯具类型"
        style={{
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--lx-fg-primary)",
          fontSize: 12,
        }}
      />
    </label>
  );
}

function PatchTable({
  fixtures,
  allFixtures,
  selectedId,
  onSelect,
}: {
  fixtures: PatchFixture[];
  allFixtures: PatchFixture[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "34px minmax(0, 1fr)", overflow: "hidden" }}>
      <div style={tableHeaderStyle}>
        {["FID", "Name", "Fixture Type", "Mode", "Patch", "Stage", "State"].map((cell) => (
          <span key={cell} style={{ padding: "0 9px" }}>
            {cell}
          </span>
        ))}
      </div>
      <div style={{ overflow: "auto" }}>
        {fixtures.map((fixture) => {
          const selected = fixture.id === selectedId;
          const state = getPatchState(allFixtures, fixture);

          return (
            <button
              key={fixture.id}
              type="button"
              onClick={() => onSelect(fixture.id)}
              className="lx-table-row"
              style={{
                display: "grid",
                width: "100%",
                gridTemplateColumns: "64px 1.15fr 1.15fr 0.95fr 86px 90px 94px",
                height: 38,
                alignItems: "center",
                border: "none",
                borderBottom: "1px solid var(--lx-stroke)",
                background: selected ? "rgba(0,120,212,0.16)" : "transparent",
                color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
                textAlign: "left",
              }}
            >
              <span className="lx-code" style={{ padding: "0 9px", color: "var(--lx-fg-primary)" }}>
                {fixture.fid}
              </span>
              <span style={{ padding: "0 9px", color: "var(--lx-fg-primary)", fontWeight: 650 }}>
                {fixture.name}
              </span>
              <span style={{ padding: "0 9px" }}>{fixture.fixtureType}</span>
              <span style={{ padding: "0 9px" }}>{fixture.mode}</span>
              <span className="lx-code" style={{ padding: "0 9px" }}>
                {fixture.patch}
              </span>
              <span style={{ padding: "0 9px" }}>{fixture.stage}</span>
              <span style={{ padding: "0 9px" }}>
                <StateBadge state={state} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Inspector({
  fixture,
  onChange,
}: {
  fixture?: PatchFixture;
  onChange: (patch: Partial<PatchFixture>) => void;
}) {
  if (!fixture) {
    return (
      <div className="lx-panel" style={{ padding: 14, color: "var(--lx-fg-tertiary)" }}>
        没有选中灯具
      </div>
    );
  }

  const modes = MODE_OPTIONS[fixture.fixtureType] ?? [];

  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>Fixture Inspector</span>
        <span className="lx-code">FID {fixture.fid}</span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
        <Field label="FID">
          <input className="lx-input lx-input-sm" value={fixture.fid} onChange={(event) => onChange({ fid: event.currentTarget.value })} />
        </Field>
        <Field label="Name">
          <input className="lx-input lx-input-sm" value={fixture.name} onChange={(event) => onChange({ name: event.currentTarget.value })} />
        </Field>
        <Field label="Fixture Type">
          <select
            className="lx-input lx-input-sm"
            value={fixture.fixtureType}
            onChange={(event) => {
              const fixtureType = event.currentTarget.value;
              onChange({ fixtureType, mode: MODE_OPTIONS[fixtureType]?.[0] ?? fixture.mode });
            }}
          >
            {FIXTURE_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select className="lx-input lx-input-sm" value={fixture.mode} onChange={(event) => onChange({ mode: event.currentTarget.value })}>
            {modes.map((mode) => (
              <option key={mode}>{mode}</option>
            ))}
          </select>
        </Field>
        <Field label="Patch">
          <input className="lx-input lx-input-sm" value={fixture.patch} onChange={(event) => onChange({ patch: normalizePatch(event.currentTarget.value) })} />
        </Field>
        <Field label="Stage">
          <select className="lx-input lx-input-sm" value={fixture.stage} onChange={(event) => onChange({ stage: event.currentTarget.value })}>
            {STAGES.map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
          </select>
        </Field>
        <div className="lx-divider-h" />
        <ToggleRow label="Pan Invert" checked={fixture.panInvert} onChange={(panInvert) => onChange({ panInvert })} />
        <ToggleRow label="Tilt Invert" checked={fixture.tiltInvert} onChange={(tiltInvert) => onChange({ tiltInvert })} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "88px minmax(0, 1fr)",
        alignItems: "center",
        gap: 8,
        color: "var(--lx-fg-tertiary)",
        fontSize: 11,
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        height: 30,
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid var(--lx-stroke)",
        borderRadius: "var(--lx-radius-sm)",
        background: checked ? "var(--lx-primary-dim)" : "var(--lx-bg-deep)",
        color: checked ? "var(--lx-primary-bright)" : "var(--lx-fg-secondary)",
        padding: "0 10px",
      }}
    >
      <span>{label}</span>
      {checked && <Check size={13} />}
    </button>
  );
}

function StageFilter({
  value,
  onChange,
  stats,
}: {
  value: string;
  onChange: (value: string) => void;
  stats: ReturnType<typeof getPatchStats>;
}) {
  return (
    <div className="lx-panel" style={{ display: "grid", alignContent: "start", gap: 7, padding: 10 }}>
      {["All", ...STAGES].map((stage) => (
        <button
          key={stage}
          type="button"
          onClick={() => onChange(stage)}
          style={{
            display: "flex",
            height: 24,
            alignItems: "center",
            justifyContent: "space-between",
            border: value === stage ? "1px solid var(--lx-primary-trace)" : "1px solid transparent",
            borderRadius: "var(--lx-radius-sm)",
            background: value === stage ? "var(--lx-primary-dim)" : "transparent",
            color: value === stage ? "var(--lx-primary-bright)" : "var(--lx-fg-secondary)",
            padding: "0 8px",
          }}
        >
          <span>{stage === "All" ? "全部舞台" : stage}</span>
          <span className="lx-code">{stage === "All" ? stats.total : stats.byStage[stage] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function UniverseStrip({ universes }: { universes: ReturnType<typeof getUniverseStats> }) {
  return (
    <div className="lx-panel" style={{ display: "grid", gap: 8, padding: 10 }}>
      {universes.map((universe) => {
        const percent = Math.min(100, Math.round((universe.used / 512) * 100));

        return (
          <div key={universe.universe}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--lx-fg-secondary)", fontSize: 11 }}>
              <span>Universe {universe.universe}</span>
              <span className="lx-code">{universe.used}/512</span>
            </div>
            <div style={{ height: 8, marginTop: 4, overflow: "hidden", borderRadius: "var(--lx-radius-xs)", background: "rgba(255,255,255,0.06)" }}>
              <div
                style={{
                  width: `${percent}%`,
                  height: "100%",
                  background: percent > 90 ? "var(--lx-status-error)" : percent > 70 ? "var(--lx-accent)" : "var(--lx-primary)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPanel({
  stats,
  logLine,
}: {
  stats: ReturnType<typeof getPatchStats>;
  logLine: string;
}) {
  return (
    <div className="lx-panel" style={{ display: "grid", gridTemplateRows: "1fr auto", padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <Metric label="Patched" value={stats.patched} />
        <Metric label="Open" value={stats.unpatched} />
        <Metric label="Fault" value={stats.overlap} tone={stats.overlap > 0 ? "var(--lx-status-error)" : undefined} />
      </div>
      <div className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
        {logLine}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "6px 8px" }}>
      <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</div>
      <div style={{ color: tone ?? "var(--lx-fg-primary)", fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function StateBadge({ state }: { state: PatchState }) {
  const label = state === "patched" ? "Patched" : state === "overlap" ? "Overlap" : "Open";
  const className = state === "patched" ? "lx-badge-success" : state === "overlap" ? "lx-badge-error" : "lx-badge-warn";

  return (
    <span className={`lx-badge ${className}`}>
      {state === "overlap" && <AlertTriangle size={10} />}
      {label}
    </span>
  );
}

function getPatchStats(fixtures: PatchFixture[]) {
  const byStage = fixtures.reduce<Record<string, number>>((acc, fixture) => {
    acc[fixture.stage] = (acc[fixture.stage] ?? 0) + 1;
    return acc;
  }, {});
  const states = fixtures.map((fixture) => getPatchState(fixtures, fixture));

  return {
    total: fixtures.length,
    patched: states.filter((state) => state === "patched").length,
    overlap: states.filter((state) => state === "overlap").length,
    unpatched: states.filter((state) => state === "unpatched").length,
    byStage,
  };
}

function getPatchState(fixtures: PatchFixture[], fixture: PatchFixture): PatchState {
  if (fixture.patch === "-") {
    return "unpatched";
  }

  const duplicated = fixtures.some((item) => item.id !== fixture.id && item.patch === fixture.patch);
  return duplicated ? "overlap" : "patched";
}

function getUniverseStats(fixtures: PatchFixture[]) {
  const universeMap = new Map<number, number>();
  fixtures.forEach((fixture) => {
    const [universeText] = fixture.patch.split(".");
    const universe = Number(universeText);
    if (!Number.isFinite(universe)) {
      return;
    }

    universeMap.set(universe, (universeMap.get(universe) ?? 0) + getModeChannels(fixture.mode));
  });

  return [1, 2, 3, 4].map((universe) => ({
    universe,
    used: universeMap.get(universe) ?? 0,
  }));
}

function getModeChannels(mode: string): number {
  const match = mode.match(/(\d+)ch/i);
  return match ? Number(match[1]) : 1;
}

function getNextFid(fixtures: PatchFixture[]): number {
  const used = fixtures.map((fixture) => Number(fixture.fid)).filter(Number.isFinite);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

function normalizeFixture(fixture: PatchFixture): PatchFixture {
  const modes = MODE_OPTIONS[fixture.fixtureType] ?? [];
  return {
    ...fixture,
    mode: modes.includes(fixture.mode) ? fixture.mode : modes[0] ?? fixture.mode,
    patch: normalizePatch(fixture.patch),
  };
}

function normalizePatch(value: string): string {
  const trimmed = value.trim();
  return trimmed.length === 0 ? "-" : trimmed;
}

const tableHeaderStyle = {
  display: "grid",
  gridTemplateColumns: "64px 1.15fr 1.15fr 0.95fr 86px 90px 94px",
  alignItems: "center",
  borderBottom: "1px solid rgba(240,157,28,0.35)",
  background: "rgba(0,0,0,0.22)",
  color: "var(--lx-fg-secondary)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
} as const;
