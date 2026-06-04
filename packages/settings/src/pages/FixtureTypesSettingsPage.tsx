import { Copy, FilePlus2, Import, Pencil, Search, ShieldCheck, Trash2 } from "lucide-react";

const FIXTURE_TYPES = [
  {
    name: "Ayrton Diablo S",
    manufacturer: "Ayrton",
    modes: "3",
    channels: "38-54",
    source: "Library",
    used: "42",
    state: "Ready",
  },
  {
    name: "Robe Pointe",
    manufacturer: "Robe",
    modes: "2",
    channels: "24-30",
    source: "Library",
    used: "24",
    state: "Ready",
  },
  {
    name: "GLP X4 Bar 20",
    manufacturer: "GLP",
    modes: "5",
    channels: "44-88",
    source: "Custom",
    used: "12",
    state: "Edited",
  },
  {
    name: "Generic Dimmer",
    manufacturer: "Generic",
    modes: "1",
    channels: "1",
    source: "System",
    used: "36",
    state: "Locked",
  },
];

const MODES = [
  { name: "Standard", channels: 38, attributes: "Dimmer, Position, Color, Beam" },
  { name: "Extended", channels: 54, attributes: "Standard + Frost, Shaper, Prism" },
  { name: "Compact", channels: 24, attributes: "Dimmer, Position, Color" },
];

const ATTRIBUTE_GROUPS = [
  { group: "Dimmer", count: 2, page: "Dimmer 1 of 1" },
  { group: "Position", count: 6, page: "Position 1 of 2" },
  { group: "Color", count: 14, page: "Color 1 of 4" },
  { group: "Beam", count: 9, page: "Beam 1 of 3" },
];

export function FixtureTypesSettingsPage() {
  return (
    <div style={{ display: "grid", minHeight: 0, gap: 14 }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 350px",
          gap: 14,
        }}
      >
        <div className="lx-panel" style={{ overflow: "hidden" }}>
          <FixtureToolbar />
          <FixtureTypeTable />
        </div>

        <TypeInspector />
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 0.95fr) minmax(320px, 0.75fr)",
          gap: 14,
        }}
      >
        <ModePanel />
        <AttributePanel />
      </section>
    </div>
  );
}

function FixtureToolbar() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(240px, 1fr) auto",
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
          搜索厂商、型号、模式、通道数量
        </span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="lx-btn lx-btn-primary">
          <FilePlus2 size={13} />
          新建类型
        </button>
        <button type="button" className="lx-btn lx-btn-ghost">
          <Import size={13} />
          导入 GDTF
        </button>
      </div>
    </div>
  );
}

function FixtureTypeTable() {
  return (
    <div style={{ minWidth: 760 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.35fr 0.8fr 62px 90px 82px 62px 84px",
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
        {["Name", "Manufacturer", "Modes", "Channels", "Source", "Used", "State"].map((cell) => (
          <span key={cell} style={{ padding: "0 9px" }}>
            {cell}
          </span>
        ))}
      </div>

      {FIXTURE_TYPES.map((row, index) => (
        <div
          key={row.name}
          className="lx-table-row"
          style={{
            display: "grid",
            gridTemplateColumns: "1.35fr 0.8fr 62px 90px 82px 62px 84px",
            height: 42,
            alignItems: "center",
            background: index === 0 ? "rgba(0,120,212,0.10)" : undefined,
          }}
        >
          <span style={{ padding: "0 9px", color: "var(--lx-fg-primary)", fontWeight: 650 }}>
            {row.name}
          </span>
          <span style={{ padding: "0 9px" }}>{row.manufacturer}</span>
          <span className="lx-code" style={{ padding: "0 9px" }}>
            {row.modes}
          </span>
          <span className="lx-code" style={{ padding: "0 9px" }}>
            {row.channels}
          </span>
          <span style={{ padding: "0 9px" }}>{row.source}</span>
          <span className="lx-code" style={{ padding: "0 9px" }}>
            {row.used}
          </span>
          <span style={{ padding: "0 9px" }}>
            <span
              className={`lx-badge ${
                row.state === "Ready"
                  ? "lx-badge-success"
                  : row.state === "Edited"
                    ? "lx-badge-warn"
                    : "lx-badge-default"
              }`}
            >
              {row.state}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TypeInspector() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={panelTitleStyle}>当前灯具类型</div>
      <div
        style={{
          border: "1px solid var(--lx-primary-trace)",
          borderRadius: "var(--lx-radius-md)",
          background: "linear-gradient(180deg, rgba(0,120,212,0.14), rgba(0,0,0,0.18))",
          padding: 13,
        }}
      >
        <div style={{ color: "var(--lx-fg-primary)", fontSize: 18, fontWeight: 850 }}>
          Ayrton Diablo S
        </div>
        <div style={{ marginTop: 5, color: "var(--lx-fg-tertiary)", fontSize: 11 }}>
          Manufacturer: Ayrton / Source: Library / Used by 42 fixtures
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
        {[
          ["Modes", "3"],
          ["Max Ch", "54"],
          ["Attrs", "31"],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              border: "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: "var(--lx-bg-deep)",
              padding: "9px 10px",
            }}
          >
            <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>{label}</div>
            <div style={{ marginTop: 4, color: "var(--lx-fg-primary)", fontSize: 17, fontWeight: 800 }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-primary">
          <Pencil size={11} />
          编辑
        </button>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost">
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

function ModePanel() {
  return (
    <div className="lx-panel" style={{ overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>模式</span>
        <span className="lx-code">3 modes</span>
      </div>
      <div style={{ display: "grid" }}>
        {MODES.map((mode, index) => (
          <div
            key={mode.name}
            className="lx-table-row"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 88px 1.45fr",
              height: 44,
              alignItems: "center",
              background: index === 0 ? "rgba(0,120,212,0.10)" : undefined,
            }}
          >
            <span style={{ color: "var(--lx-fg-primary)", fontWeight: 700 }}>{mode.name}</span>
            <span className="lx-code">{mode.channels} ch</span>
            <span>{mode.attributes}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttributePanel() {
  return (
    <div className="lx-panel" style={{ padding: 14 }}>
      <div style={{ ...panelTitleStyle, display: "flex", justifyContent: "space-between" }}>
        <span>编码器属性分组</span>
        <ShieldCheck size={14} style={{ color: "var(--lx-action-bright)" }} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {ATTRIBUTE_GROUPS.map((item) => (
          <div
            key={item.group}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 54px 96px",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: "var(--lx-bg-deep)",
              padding: "9px 10px",
              color: "var(--lx-fg-secondary)",
            }}
          >
            <span style={{ color: "var(--lx-fg-primary)", fontWeight: 700 }}>{item.group}</span>
            <span className="lx-code">{item.count}</span>
            <span className="lx-code" style={{ color: "var(--lx-accent-bright)" }}>
              {item.page}
            </span>
          </div>
        ))}
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
