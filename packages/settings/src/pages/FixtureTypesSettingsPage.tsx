import { useDeferredValue, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Copy,
  FilePlus2,
  Import,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { ResizableDataTable } from "../components/ResizableDataTable";
import type { DataTableColumn } from "../components/ResizableDataTable";

interface FixtureMode {
  id: string;
  name: string;
  channels: number;
  attributes: string;
}

interface AttributeGroup {
  id: string;
  name: string;
  count: number;
  encoderPage: string;
}

interface FixtureType {
  id: string;
  name: string;
  manufacturer: string;
  source: "Library" | "Custom" | "System";
  used: number;
  locked: boolean;
  modes: FixtureMode[];
  attributes: AttributeGroup[];
}

const INITIAL_TYPES: FixtureType[] = [
  {
    id: "type-ayrton-diablo",
    name: "Ayrton Diablo S",
    manufacturer: "Ayrton",
    source: "Library",
    used: 42,
    locked: false,
    modes: [
      { id: "standard", name: "Standard", channels: 38, attributes: "Dimmer, Position, Color, Beam" },
      { id: "extended", name: "Extended", channels: 54, attributes: "Standard + Frost, Shaper, Prism" },
      { id: "compact", name: "Compact", channels: 24, attributes: "Dimmer, Position, Color" },
    ],
    attributes: [
      { id: "dimmer", name: "Dimmer", count: 2, encoderPage: "Dimmer 1 of 1" },
      { id: "position", name: "Position", count: 6, encoderPage: "Position 1 of 2" },
      { id: "color", name: "Color", count: 14, encoderPage: "Color 1 of 4" },
      { id: "beam", name: "Beam", count: 9, encoderPage: "Beam 1 of 3" },
    ],
  },
  {
    id: "type-robe-pointe",
    name: "Robe Pointe",
    manufacturer: "Robe",
    source: "Library",
    used: 24,
    locked: false,
    modes: [
      { id: "mode-1", name: "Mode 1", channels: 24, attributes: "Dimmer, Position, Color, Beam" },
      { id: "mode-2", name: "Mode 2", channels: 30, attributes: "Mode 1 + Prism, Frost" },
    ],
    attributes: [
      { id: "dimmer", name: "Dimmer", count: 1, encoderPage: "Dimmer 1 of 1" },
      { id: "position", name: "Position", count: 4, encoderPage: "Position 1 of 1" },
      { id: "beam", name: "Beam", count: 8, encoderPage: "Beam 1 of 2" },
    ],
  },
  {
    id: "type-glp-x4",
    name: "GLP X4 Bar 20",
    manufacturer: "GLP",
    source: "Custom",
    used: 12,
    locked: false,
    modes: [
      { id: "basic", name: "Basic", channels: 44, attributes: "Dimmer, Color, Tilt" },
      { id: "pixel", name: "Pixel", channels: 88, attributes: "Basic + Pixel Cells" },
    ],
    attributes: [
      { id: "dimmer", name: "Dimmer", count: 20, encoderPage: "Dimmer 1 of 5" },
      { id: "color", name: "Color", count: 60, encoderPage: "Color 1 of 15" },
      { id: "position", name: "Position", count: 2, encoderPage: "Position 1 of 1" },
    ],
  },
  {
    id: "type-generic-dimmer",
    name: "Generic Dimmer",
    manufacturer: "Generic",
    source: "System",
    used: 36,
    locked: true,
    modes: [{ id: "dimmer", name: "Dimmer", channels: 1, attributes: "Dimmer" }],
    attributes: [{ id: "dimmer", name: "Dimmer", count: 1, encoderPage: "Dimmer 1 of 1" }],
  },
];

export function FixtureTypesSettingsPage() {
  const [fixtureTypes, setFixtureTypes] = useState(INITIAL_TYPES);
  const [selectedId, setSelectedId] = useState(INITIAL_TYPES[0]?.id ?? "");
  const [selectedModeId, setSelectedModeId] = useState(INITIAL_TYPES[0]?.modes[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [logLine, setLogLine] = useState("Ready");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectedType = fixtureTypes.find((item) => item.id === selectedId) ?? fixtureTypes[0];
  const selectedMode = selectedType?.modes.find((mode) => mode.id === selectedModeId) ?? selectedType?.modes[0];
  const visibleTypes = fixtureTypes.filter((fixtureType) =>
    `${fixtureType.name} ${fixtureType.manufacturer} ${fixtureType.source}`.toLowerCase().includes(deferredQuery),
  );

  const selectType = (id: string) => {
    const fixtureType = fixtureTypes.find((item) => item.id === id);
    setSelectedId(id);
    setSelectedModeId(fixtureType?.modes[0]?.id ?? "");
  };

  const updateSelectedType = (patch: Partial<FixtureType>) => {
    if (!selectedType || selectedType.locked) {
      return;
    }

    setFixtureTypes((current) =>
      current.map((fixtureType) =>
        fixtureType.id === selectedType.id ? { ...fixtureType, ...patch, source: "Custom" } : fixtureType,
      ),
    );
    setLogLine(`Edited ${selectedType.name}`);
  };

  const updateMode = (modeId: string, patch: Partial<FixtureMode>) => {
    if (!selectedType || selectedType.locked) {
      return;
    }

    setFixtureTypes((current) =>
      current.map((fixtureType) =>
        fixtureType.id === selectedType.id
          ? {
              ...fixtureType,
              source: "Custom",
              modes: fixtureType.modes.map((mode) => (mode.id === modeId ? { ...mode, ...patch } : mode)),
            }
          : fixtureType,
      ),
    );
    setLogLine(`Edited mode ${patch.name ?? modeId}`);
  };

  const addType = () => {
    const fixtureType: FixtureType = {
      id: `type-${Date.now()}`,
      name: "New Fixture Type",
      manufacturer: "Custom",
      source: "Custom",
      used: 0,
      locked: false,
      modes: [{ id: "default", name: "Default", channels: 16, attributes: "Dimmer, Position, Color" }],
      attributes: [
        { id: "dimmer", name: "Dimmer", count: 1, encoderPage: "Dimmer 1 of 1" },
        { id: "position", name: "Position", count: 4, encoderPage: "Position 1 of 1" },
      ],
    };

    setFixtureTypes((current) => [...current, fixtureType]);
    setSelectedId(fixtureType.id);
    setSelectedModeId("default");
    setLogLine("Created new fixture type");
  };

  const duplicateType = () => {
    if (!selectedType) {
      return;
    }

    const fixtureType = {
      ...selectedType,
      id: `type-${Date.now()}`,
      name: `${selectedType.name} Copy`,
      source: "Custom" as const,
      used: 0,
      locked: false,
    };

    setFixtureTypes((current) => [...current, fixtureType]);
    setSelectedId(fixtureType.id);
    setSelectedModeId(fixtureType.modes[0]?.id ?? "");
    setLogLine(`Duplicated ${selectedType.name}`);
  };

  const deleteType = () => {
    if (!selectedType || selectedType.locked || selectedType.used > 0) {
      return;
    }

    setFixtureTypes((current) => {
      const next = current.filter((fixtureType) => fixtureType.id !== selectedType.id);
      setSelectedId(next[0]?.id ?? "");
      setSelectedModeId(next[0]?.modes[0]?.id ?? "");
      return next;
    });
    setLogLine(`Deleted ${selectedType.name}`);
  };

  const addMode = () => {
    if (!selectedType || selectedType.locked) {
      return;
    }

    const mode: FixtureMode = {
      id: `mode-${Date.now()}`,
      name: `Mode ${selectedType.modes.length + 1}`,
      channels: 16,
      attributes: "Dimmer, Position",
    };

    setFixtureTypes((current) =>
      current.map((fixtureType) =>
        fixtureType.id === selectedType.id
          ? { ...fixtureType, source: "Custom", modes: [...fixtureType.modes, mode] }
          : fixtureType,
      ),
    );
    setSelectedModeId(mode.id);
    setLogLine(`Added mode to ${selectedType.name}`);
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
          <button type="button" className="lx-btn lx-btn-primary" onClick={addType}>
            <FilePlus2 size={13} />
            新建类型
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={duplicateType} disabled={!selectedType}>
            <Copy size={13} />
            复制
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" disabled>
            <Import size={13} />
            导入 GDTF
          </button>
          <button
            type="button"
            className="lx-btn lx-btn-ghost"
            onClick={deleteType}
            disabled={!selectedType || selectedType.locked || selectedType.used > 0}
          >
            <Trash2 size={13} />
            删除
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          minHeight: 0,
          gridTemplateColumns: "minmax(0, 1fr) 330px",
          gap: 10,
        }}
      >
        <FixtureTypeTable
          fixtureTypes={visibleTypes}
          selectedId={selectedId}
          onSelect={selectType}
        />
        <TypeInspector fixtureType={selectedType} onChange={updateSelectedType} />
      </div>

      <div
        style={{
          display: "grid",
          minHeight: 0,
          gridTemplateColumns: "minmax(0, 1fr) 340px 250px",
          gap: 10,
        }}
      >
        <ModePanel
          fixtureType={selectedType}
          selectedModeId={selectedMode?.id ?? ""}
          onSelectMode={setSelectedModeId}
          onChangeMode={updateMode}
          onAddMode={addMode}
        />
        <AttributePanel fixtureType={selectedType} />
        <LibraryStatus fixtureTypes={fixtureTypes} logLine={logLine} />
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
        placeholder="搜索厂商、型号、模式、通道数量"
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

function FixtureTypeTable({
  fixtureTypes,
  selectedId,
  onSelect,
}: {
  fixtureTypes: FixtureType[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const columns: Array<DataTableColumn<FixtureType>> = [
    {
      id: "name",
      label: "Name",
      width: 210,
      minWidth: 150,
      render: (fixtureType) => (
        <span style={{ color: "var(--lx-fg-primary)", fontWeight: 650 }}>
          {fixtureType.name}
        </span>
      ),
    },
    {
      id: "manufacturer",
      label: "Manufacturer",
      width: 150,
      minWidth: 110,
      render: (fixtureType) => fixtureType.manufacturer,
    },
    {
      id: "modes",
      label: "Modes",
      width: 76,
      minWidth: 62,
      render: (fixtureType) => <span className="lx-code">{fixtureType.modes.length}</span>,
    },
    {
      id: "channels",
      label: "Channels",
      width: 118,
      minWidth: 90,
      render: (fixtureType) => <span className="lx-code">{getChannelRange(fixtureType)}</span>,
    },
    {
      id: "source",
      label: "Source",
      width: 100,
      minWidth: 82,
      render: (fixtureType) => fixtureType.source,
    },
    {
      id: "used",
      label: "Used",
      width: 76,
      minWidth: 62,
      render: (fixtureType) => <span className="lx-code">{fixtureType.used}</span>,
    },
    {
      id: "state",
      label: "State",
      width: 112,
      minWidth: 96,
      render: (fixtureType) => (
        <span className={`lx-badge ${getStateClass(fixtureType)}`}>
          {fixtureType.locked ? "Locked" : fixtureType.source === "Custom" ? "Edited" : "Ready"}
        </span>
      ),
    },
  ];

  return (
    <ResizableDataTable
      columns={columns}
      rows={fixtureTypes}
      selectedId={selectedId}
      getRowId={(fixtureType) => fixtureType.id}
      onRowClick={(fixtureType) => onSelect(fixtureType.id)}
    />
  );
}

function TypeInspector({
  fixtureType,
  onChange,
}: {
  fixtureType?: FixtureType;
  onChange: (patch: Partial<FixtureType>) => void;
}) {
  if (!fixtureType) {
    return (
      <div className="lx-panel" style={{ padding: 14, color: "var(--lx-fg-tertiary)" }}>
        没有选中灯具类型
      </div>
    );
  }

  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>Type Inspector</span>
        <span className="lx-code">{fixtureType.source}</span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
        <Field label="Name">
          <input
            className="lx-input lx-input-sm"
            value={fixtureType.name}
            readOnly={fixtureType.locked}
            onChange={(event) => onChange({ name: event.currentTarget.value })}
          />
        </Field>
        <Field label="Maker">
          <input
            className="lx-input lx-input-sm"
            value={fixtureType.manufacturer}
            readOnly={fixtureType.locked}
            onChange={(event) => onChange({ manufacturer: event.currentTarget.value })}
          />
        </Field>
        <Field label="Source">
          <input className="lx-input lx-input-sm" value={fixtureType.source} readOnly />
        </Field>
        <Field label="Used">
          <input className="lx-input lx-input-sm" value={fixtureType.used} readOnly />
        </Field>
        <div className="lx-divider-h" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Metric label="Modes" value={fixtureType.modes.length} />
          <Metric label="Max Ch" value={Math.max(...fixtureType.modes.map((mode) => mode.channels))} />
          <Metric label="Groups" value={fixtureType.attributes.length} />
        </div>
        {fixtureType.locked && (
          <div className="lx-badge lx-badge-default" style={{ width: "fit-content" }}>
            System locked
          </div>
        )}
      </div>
    </div>
  );
}

function ModePanel({
  fixtureType,
  selectedModeId,
  onSelectMode,
  onChangeMode,
  onAddMode,
}: {
  fixtureType?: FixtureType;
  selectedModeId: string;
  onSelectMode: (id: string) => void;
  onChangeMode: (id: string, patch: Partial<FixtureMode>) => void;
  onAddMode: () => void;
}) {
  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "28px minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>模式</span>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost" onClick={onAddMode} disabled={!fixtureType || fixtureType.locked}>
          <Plus size={11} />
          添加模式
        </button>
      </div>
      <div style={{ overflow: "auto" }}>
        {fixtureType?.modes.map((mode) => {
          const selected = mode.id === selectedModeId;

          return (
            <button
              key={mode.id}
              type="button"
              className="lx-table-row"
              onClick={() => onSelectMode(mode.id)}
              style={{
                display: "grid",
                width: "100%",
                gridTemplateColumns: "1fr 72px 1.45fr 30px",
                height: 36,
                alignItems: "center",
                border: "none",
                borderBottom: "1px solid var(--lx-stroke)",
                background: selected ? "rgba(0,120,212,0.16)" : "transparent",
                color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
                textAlign: "left",
              }}
            >
              <span style={{ color: "var(--lx-fg-primary)", fontWeight: 700 }}>{mode.name}</span>
              <span className="lx-code">{mode.channels} ch</span>
              <span>{mode.attributes}</span>
              <Pencil
                size={12}
                style={{ color: fixtureType.locked ? "var(--lx-fg-muted)" : "var(--lx-fg-tertiary)" }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!fixtureType.locked) {
                    onChangeMode(mode.id, { channels: mode.channels + 1 });
                  }
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AttributePanel({ fixtureType }: { fixtureType?: FixtureType }) {
  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "28px minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>编码器属性分组</span>
        <span className="lx-code">{fixtureType?.attributes.length ?? 0} groups</span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 8, overflow: "auto", padding: 10 }}>
        {fixtureType?.attributes.map((item) => (
          <div
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 54px 96px",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: "var(--lx-bg-deep)",
              padding: "8px 9px",
              color: "var(--lx-fg-secondary)",
            }}
          >
            <span style={{ color: "var(--lx-fg-primary)", fontWeight: 700 }}>{item.name}</span>
            <span className="lx-code">{item.count}</span>
            <span className="lx-code" style={{ color: "var(--lx-accent-bright)" }}>
              {item.encoderPage}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryStatus({
  fixtureTypes,
  logLine,
}: {
  fixtureTypes: FixtureType[];
  logLine: string;
}) {
  const custom = fixtureTypes.filter((item) => item.source === "Custom").length;
  const locked = fixtureTypes.filter((item) => item.locked).length;
  const used = fixtureTypes.reduce((sum, item) => sum + item.used, 0);

  return (
    <div className="lx-panel" style={{ display: "grid", gridTemplateRows: "1fr auto", padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <Metric label="Types" value={fixtureTypes.length} />
        <Metric label="Custom" value={custom} />
        <Metric label="Used" value={used} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
        <Check size={12} style={{ color: locked > 0 ? "var(--lx-action-bright)" : "var(--lx-fg-tertiary)" }} />
        <span className="lx-code">{logLine}</span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "82px minmax(0, 1fr)",
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "6px 8px" }}>
      <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</div>
      <div style={{ color: "var(--lx-fg-primary)", fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function getChannelRange(fixtureType: FixtureType): string {
  const channels = fixtureType.modes.map((mode) => mode.channels);
  const min = Math.min(...channels);
  const max = Math.max(...channels);
  return min === max ? String(min) : `${min}-${max}`;
}

function getStateClass(fixtureType: FixtureType): string {
  if (fixtureType.locked) {
    return "lx-badge-default";
  }

  return fixtureType.source === "Custom" ? "lx-badge-warn" : "lx-badge-success";
}
