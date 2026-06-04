import { Check, Copy, Download, Plus, Search, Trash2, Upload } from "lucide-react";

const PATCH_ROWS = [
  {
    fid: "1",
    name: "Wash Truss L",
    fixtureType: "Ayrton Diablo S",
    mode: "Standard 38ch",
    patch: "1.001",
    stage: "Main",
    status: "Patched",
  },
  {
    fid: "2",
    name: "Wash Truss R",
    fixtureType: "Ayrton Diablo S",
    mode: "Standard 38ch",
    patch: "1.039",
    stage: "Main",
    status: "Patched",
  },
  {
    fid: "11",
    name: "Beam Upstage",
    fixtureType: "Robe Pointe",
    mode: "Mode 2",
    patch: "2.001",
    stage: "Main",
    status: "Overlap",
  },
  {
    fid: "31",
    name: "Pixel Bar DS",
    fixtureType: "GLP X4 Bar 20",
    mode: "Pixel 88ch",
    patch: "-",
    stage: "Stage B",
    status: "Unpatched",
  },
];

const UNIVERSES = [
  { label: "Universe 1", used: 284, total: 512, output: "Node A / Port 1" },
  { label: "Universe 2", used: 176, total: 512, output: "Node A / Port 2" },
  { label: "Universe 3", used: 0, total: 512, output: "Unassigned" },
];

const STAGES = [
  { name: "Main", fixtures: 128, bounds: "28m x 14m", active: true },
  { name: "Stage B", fixtures: 24, bounds: "12m x 8m", active: false },
  { name: "Previs", fixtures: 16, bounds: "Virtual", active: false },
];

export function ConnectivitySettingsPage() {
  return (
    <div style={{ display: "grid", minHeight: 0, gap: 14 }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 280px",
          gap: 14,
        }}
      >
        <div className="lx-panel" style={{ overflow: "hidden" }}>
          <Toolbar />
          <PatchTable />
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <SummaryPanel />
          <StagePanel />
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 14,
        }}
      >
        <UniversePanel />
        <SelectionPanel />
      </section>
    </div>
  );
}

function Toolbar() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1fr) auto",
        gap: 10,
        alignItems: "center",
        padding: 10,
        borderBottom: "1px solid var(--lx-stroke)",
        background: "var(--lx-bg-deep)",
      }}
    >
      <div
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
        <span style={{ color: "var(--lx-fg-muted)", fontSize: 11 }}>
          搜索 FID、灯具名、地址、灯具类型
        </span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="lx-btn lx-btn-primary">
          <Plus size={13} />
          添加灯具
        </button>
        <button type="button" className="lx-btn lx-btn-ghost">
          <Upload size={13} />
          导入
        </button>
        <button type="button" className="lx-btn lx-btn-ghost">
          <Download size={13} />
          导出
        </button>
      </div>
    </div>
  );
}

function PatchTable() {
  return (
    <div style={{ minWidth: 780 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "64px 1.1fr 1.15fr 0.9fr 86px 90px 96px",
          height: 34,
          alignItems: "center",
          borderBottom: "1px solid rgba(240,157,28,0.35)",
          background: "rgba(0,0,0,0.22)",
          color: "var(--lx-fg-secondary)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {["FID", "Name", "Fixture Type", "Mode", "Patch", "Stage", "State"].map((cell) => (
          <span key={cell} style={{ padding: "0 9px" }}>
            {cell}
          </span>
        ))}
      </div>

      {PATCH_ROWS.map((row, index) => (
        <div
          key={row.fid}
          className="lx-table-row"
          style={{
            display: "grid",
            gridTemplateColumns: "64px 1.1fr 1.15fr 0.9fr 86px 90px 96px",
            height: 42,
            alignItems: "center",
            background: index === 0 ? "rgba(0,120,212,0.10)" : undefined,
          }}
        >
          <span className="lx-code" style={{ padding: "0 9px", color: "var(--lx-fg-primary)" }}>
            {row.fid}
          </span>
          <span style={{ padding: "0 9px", color: "var(--lx-fg-primary)", fontWeight: 650 }}>
            {row.name}
          </span>
          <span style={{ padding: "0 9px" }}>{row.fixtureType}</span>
          <span style={{ padding: "0 9px" }}>{row.mode}</span>
          <span className="lx-code" style={{ padding: "0 9px" }}>
            {row.patch}
          </span>
          <span style={{ padding: "0 9px" }}>{row.stage}</span>
          <span style={{ padding: "0 9px" }}>
            <span
              className={`lx-badge ${
                row.status === "Patched"
                  ? "lx-badge-success"
                  : row.status === "Overlap"
                    ? "lx-badge-error"
                    : "lx-badge-warn"
              }`}
            >
              {row.status}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SummaryPanel() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={panelTitleStyle}>配接概况</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
        {[
          ["灯具", "168"],
          ["已配接", "143"],
          ["冲突", "1"],
          ["空地址", "25"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              border: "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: "var(--lx-bg-deep)",
              padding: "10px 11px",
            }}
          >
            <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>{label}</div>
            <div style={{ marginTop: 5, color: "var(--lx-fg-primary)", fontSize: 20, fontWeight: 800 }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StagePanel() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={panelTitleStyle}>舞台</div>
      <div style={{ display: "grid", gap: 7 }}>
        {STAGES.map((stage) => (
          <button
            key={stage.name}
            type="button"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              alignItems: "center",
              border: stage.active ? "1px solid var(--lx-primary-trace)" : "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: stage.active ? "var(--lx-primary-dim)" : "var(--lx-bg-deep)",
              padding: "9px 10px",
              color: "var(--lx-fg-secondary)",
              textAlign: "left",
            }}
          >
            <span>
              <span style={{ display: "block", color: "var(--lx-fg-primary)", fontWeight: 700 }}>
                {stage.name}
              </span>
              <span style={{ display: "block", marginTop: 3, color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
                {stage.fixtures} fixtures / {stage.bounds}
              </span>
            </span>
            {stage.active && <Check size={14} style={{ color: "var(--lx-primary-bright)" }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function UniversePanel() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={{ ...panelTitleStyle, display: "flex", justifyContent: "space-between" }}>
        <span>DMX Universe 占用</span>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost">
          自动分配
        </button>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {UNIVERSES.map((universe) => {
          const percent = Math.round((universe.used / universe.total) * 100);

          return (
            <div key={universe.label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "var(--lx-fg-secondary)",
                  fontSize: 11,
                }}
              >
                <span>{universe.label}</span>
                <span className="lx-code">
                  {universe.used}/{universe.total} / {universe.output}
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  marginTop: 6,
                  overflow: "hidden",
                  borderRadius: "var(--lx-radius-xs)",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    width: `${percent}%`,
                    height: "100%",
                    background:
                      percent > 70
                        ? "linear-gradient(90deg, var(--lx-accent), var(--lx-status-error))"
                        : "linear-gradient(90deg, var(--lx-primary), var(--lx-action))",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionPanel() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={panelTitleStyle}>选中灯具</div>
      <div style={{ display: "grid", gap: 8 }}>
        {[
          ["FID", "1"],
          ["Name", "Wash Truss L"],
          ["Fixture Type", "Ayrton Diablo S"],
          ["Patch", "1.001"],
        ].map(([label, value]) => (
          <label
            key={label}
            style={{
              display: "grid",
              gridTemplateColumns: "92px minmax(0, 1fr)",
              alignItems: "center",
              gap: 8,
              color: "var(--lx-fg-tertiary)",
              fontSize: 11,
            }}
          >
            <span>{label}</span>
            <input className="lx-input lx-input-sm" value={value} readOnly />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-primary">
          <Copy size={11} />
          复制
        </button>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost">
          <Trash2 size={11} />
          删除
        </button>
      </div>
    </div>
  );
}

const panelTitleStyle = {
  marginBottom: 10,
  color: "var(--lx-fg-primary)",
  fontSize: 13,
  fontWeight: 800,
} as const;
