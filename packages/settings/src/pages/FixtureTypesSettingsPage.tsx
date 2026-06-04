import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  FilePlus2,
  Import,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { ResizableDataTable } from "../components/ResizableDataTable";
import type { DataTableColumn } from "../components/ResizableDataTable";

interface FixtureMode {
  id: string;
  name: string;
  channels: number;
  attributes: string[];
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
  shortName: string;
  longName: string;
  description: string;
  source: "Gdtf" | "Custom";
  used: number;
  locked: boolean;
  path: string;
  sizeBytes: number;
  modes: FixtureMode[];
  attributes: AttributeGroup[];
}

interface FixtureTypeDraft {
  name: string;
  manufacturer: string;
  shortName: string;
  longName: string;
  description: string;
  modes: FixtureModeDraft[];
}

interface FixtureModeDraft {
  id: string;
  name: string;
  channels: number;
  attributes: string[];
}

const DEFAULT_DRAFT: FixtureTypeDraft = {
  name: "New Fixture Type",
  manufacturer: "Custom",
  shortName: "New",
  longName: "New Fixture Type",
  description: "Created in LimxDesk",
  modes: [
    {
      id: "basic",
      name: "Basic",
      channels: 1,
      attributes: ["Dimmer"],
    },
  ],
};

export function FixtureTypesSettingsPage() {
  const [fixtureTypes, setFixtureTypes] = useState<FixtureType[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [draft, setDraft] = useState<FixtureTypeDraft>(DEFAULT_DRAFT);
  const [query, setQuery] = useState("");
  const [libraryRoot, setLibraryRoot] = useState("C:/ProgramData/LimxDesk/Library/FixtureTypes/GDTF");
  const [logLine, setLogLine] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectedType = fixtureTypes.find((item) => item.path === selectedPath) ?? fixtureTypes[0];
  const visibleTypes = fixtureTypes.filter((fixtureType) =>
    `${fixtureType.name} ${fixtureType.manufacturer} ${fixtureType.shortName} ${fixtureType.path}`
      .toLowerCase()
      .includes(deferredQuery),
  );
  const draftAttributeGroups = useMemo(() => summarizeDraftAttributes(draft), [draft]);

  useEffect(() => {
    void refreshLibrary();
  }, []);

  useEffect(() => {
    if (selectedType && !dirty) {
      setDraft(entryToDraft(selectedType));
    }
  }, [dirty, selectedType]);

  const refreshLibrary = async (preferredPath?: string) => {
    setBusy(true);
    try {
      const [root, entries] = await Promise.all([
        invoke<string>("fixture_type_library_root"),
        invoke<FixtureType[]>("fixture_type_scan_library"),
      ]);
      setLibraryRoot(root);
      setFixtureTypes(entries);

      const nextSelected =
        preferredPath && entries.some((item) => item.path === preferredPath)
          ? preferredPath
          : selectedPath && entries.some((item) => item.path === selectedPath)
            ? selectedPath
            : entries[0]?.path ?? "";
      setSelectedPath(nextSelected);
      setDirty(false);
      setLogLine(`Scanned ${entries.length} GDTF fixture type${entries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const selectType = (path: string) => {
    const fixtureType = fixtureTypes.find((item) => item.path === path);
    setSelectedPath(path);
    if (fixtureType) {
      setDraft(entryToDraft(fixtureType));
      setDirty(false);
    }
  };

  const importGdtf = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "GDTF Fixture Type", extensions: ["gdtf"] }],
    });
    if (typeof selected !== "string") {
      return;
    }

    setBusy(true);
    try {
      const imported = await invoke<FixtureType>("fixture_type_import_gdtf", { path: selected });
      await refreshLibrary(imported.path);
      setLogLine(`Imported ${imported.manufacturer} ${imported.name}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const createType = async () => {
    setBusy(true);
    try {
      const created = await invoke<FixtureType>("fixture_type_create", {
        draft: {
          ...DEFAULT_DRAFT,
          name: nextFixtureName(fixtureTypes),
          longName: nextFixtureName(fixtureTypes),
        },
      });
      await refreshLibrary(created.path);
      setLogLine(`Created ${created.name}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveType = async () => {
    if (!selectedType) {
      return;
    }

    setBusy(true);
    try {
      const updated = await invoke<FixtureType>("fixture_type_update", {
        path: selectedType.path,
        draft: normalizeDraft(draft),
      });
      await refreshLibrary(updated.path);
      setLogLine(`Saved ${updated.name}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteType = async () => {
    if (!selectedType || selectedType.used > 0) {
      return;
    }

    setBusy(true);
    try {
      await invoke<void>("fixture_type_delete", { path: selectedType.path });
      await refreshLibrary();
      setLogLine(`Deleted ${selectedType.name}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (patch: Partial<FixtureTypeDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };

  const updateMode = (modeId: string, patch: Partial<FixtureModeDraft>) => {
    setDraft((current) => ({
      ...current,
      modes: current.modes.map((mode) => (mode.id === modeId ? { ...mode, ...patch } : mode)),
    }));
    setDirty(true);
  };

  const addMode = () => {
    const mode: FixtureModeDraft = {
      id: `mode-${Date.now()}`,
      name: `Mode ${draft.modes.length + 1}`,
      channels: 1,
      attributes: ["Dimmer"],
    };
    setDraft((current) => ({ ...current, modes: [...current.modes, mode] }));
    setDirty(true);
  };

  const deleteMode = (modeId: string) => {
    if (draft.modes.length <= 1) {
      return;
    }
    setDraft((current) => ({ ...current, modes: current.modes.filter((mode) => mode.id !== modeId) }));
    setDirty(true);
  };

  return (
    <div
      style={{
        display: "grid",
        minHeight: 0,
        height: "100%",
        gridTemplateRows: "auto minmax(0, 1fr) 136px",
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
          <button type="button" className="lx-btn lx-btn-primary" onClick={() => void createType()} disabled={busy}>
            <FilePlus2 size={13} />
            新建 GDTF
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => void importGdtf()} disabled={busy}>
            <Import size={13} />
            导入 GDTF
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => void refreshLibrary()} disabled={busy}>
            <RefreshCw size={13} />
            刷新
          </button>
          <button type="button" className="lx-btn lx-btn-action" onClick={() => void saveType()} disabled={busy || !selectedType || !dirty}>
            <Save size={13} />
            保存修改
          </button>
          <button
            type="button"
            className="lx-btn lx-btn-ghost"
            onClick={() => void deleteType()}
            disabled={busy || !selectedType || selectedType.used > 0}
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
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 10,
        }}
      >
        <FixtureTypeTable fixtureTypes={visibleTypes} selectedPath={selectedType?.path ?? ""} onSelect={selectType} />
        <TypeInspector
          fixtureType={selectedType}
          draft={draft}
          libraryRoot={libraryRoot}
          dirty={dirty}
          onChange={updateDraft}
        />
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
          draft={draft}
          onAddMode={addMode}
          onDeleteMode={deleteMode}
          onChangeMode={updateMode}
        />
        <AttributePanel attributes={draftAttributeGroups} />
        <LibraryStatus fixtureTypes={fixtureTypes} logLine={busy ? "Working..." : logLine} dirty={dirty} />
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
        placeholder="搜索厂商、型号、GUID、GDTF 路径"
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
  selectedPath,
  onSelect,
}: {
  fixtureTypes: FixtureType[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const columns: Array<DataTableColumn<FixtureType>> = [
    {
      id: "name",
      label: "Name",
      width: 220,
      minWidth: 150,
      render: (fixtureType) => (
        <span style={{ color: "var(--lx-fg-primary)", fontWeight: 650 }}>{fixtureType.name}</span>
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
      width: 96,
      minWidth: 82,
      render: () => "GDTF",
    },
    {
      id: "size",
      label: "Size",
      width: 90,
      minWidth: 72,
      render: (fixtureType) => <span className="lx-code">{formatBytes(fixtureType.sizeBytes)}</span>,
    },
    {
      id: "state",
      label: "State",
      width: 112,
      minWidth: 96,
      render: (fixtureType) => (
        <span className={`lx-badge ${fixtureType.locked ? "lx-badge-default" : "lx-badge-success"}`}>
          {fixtureType.locked ? "Locked" : "Ready"}
        </span>
      ),
    },
  ];

  return (
    <ResizableDataTable
      columns={columns}
      rows={fixtureTypes}
      selectedId={selectedPath}
      getRowId={(fixtureType) => fixtureType.path}
      onRowClick={(fixtureType) => onSelect(fixtureType.path)}
    />
  );
}

function TypeInspector({
  fixtureType,
  draft,
  libraryRoot,
  dirty,
  onChange,
}: {
  fixtureType?: FixtureType;
  draft: FixtureTypeDraft;
  libraryRoot: string;
  dirty: boolean;
  onChange: (patch: Partial<FixtureTypeDraft>) => void;
}) {
  if (!fixtureType) {
    return (
      <div className="lx-panel" style={{ padding: 14, color: "var(--lx-fg-tertiary)" }}>
        没有 GDTF 灯具类型。请导入或新建。
      </div>
    );
  }

  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>GDTF Inspector</span>
        <span className={`lx-badge ${dirty ? "lx-badge-warn" : "lx-badge-success"}`}>
          {dirty ? "Unsaved" : "Synced"}
        </span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
        <Field label="Name">
          <input className="lx-input lx-input-sm" value={draft.name} onChange={(event) => onChange({ name: event.currentTarget.value })} />
        </Field>
        <Field label="Maker">
          <input className="lx-input lx-input-sm" value={draft.manufacturer} onChange={(event) => onChange({ manufacturer: event.currentTarget.value })} />
        </Field>
        <Field label="Short">
          <input className="lx-input lx-input-sm" value={draft.shortName} onChange={(event) => onChange({ shortName: event.currentTarget.value })} />
        </Field>
        <Field label="Long">
          <input className="lx-input lx-input-sm" value={draft.longName} onChange={(event) => onChange({ longName: event.currentTarget.value })} />
        </Field>
        <Field label="Desc">
          <textarea
            className="lx-input lx-input-sm"
            value={draft.description}
            onChange={(event) => onChange({ description: event.currentTarget.value })}
            style={{ minHeight: 54, resize: "vertical", paddingTop: 5 }}
          />
        </Field>
        <div className="lx-divider-h" />
        <InfoRow label="GUID" value={fixtureType.id} />
        <InfoRow label="Path" value={fixtureType.path} />
        <InfoRow label="Library" value={libraryRoot} />
      </div>
    </div>
  );
}

function ModePanel({
  draft,
  onAddMode,
  onDeleteMode,
  onChangeMode,
}: {
  draft: FixtureTypeDraft;
  onAddMode: () => void;
  onDeleteMode: (id: string) => void;
  onChangeMode: (id: string, patch: Partial<FixtureModeDraft>) => void;
}) {
  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "28px minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>DMX Modes</span>
        <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost" onClick={onAddMode}>
          <Plus size={11} />
          添加模式
        </button>
      </div>
      <div style={{ overflow: "auto" }}>
        {draft.modes.map((mode) => (
          <div
            key={mode.id}
            style={{
              display: "grid",
              gridTemplateColumns: "150px 78px minmax(220px, 1fr) 54px",
              gap: 8,
              alignItems: "center",
              minHeight: 42,
              borderBottom: "1px solid var(--lx-stroke)",
              padding: "6px 8px",
              color: "var(--lx-fg-secondary)",
            }}
          >
            <input
              className="lx-input lx-input-sm"
              value={mode.name}
              onChange={(event) => onChangeMode(mode.id, { name: event.currentTarget.value })}
            />
            <input
              className="lx-input lx-input-sm"
              type="number"
              min={1}
              max={512}
              value={mode.channels}
              onChange={(event) => onChangeMode(mode.id, { channels: Number(event.currentTarget.value) })}
            />
            <input
              className="lx-input lx-input-sm"
              value={mode.attributes.join(", ")}
              onChange={(event) => onChangeMode(mode.id, { attributes: parseAttributeList(event.currentTarget.value) })}
              title="逗号分隔 GDTF Attribute 名称，例如 Dimmer, Pan, Tilt, ColorAdd_R"
            />
            <button
              type="button"
              className="lx-btn lx-btn-sm lx-btn-ghost"
              onClick={() => onDeleteMode(mode.id)}
              disabled={draft.modes.length <= 1}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttributePanel({ attributes }: { attributes: AttributeGroup[] }) {
  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "28px minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>编码器属性分组</span>
        <span className="lx-code">{attributes.length} groups</span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 8, overflow: "auto", padding: 10 }}>
        {attributes.map((item) => (
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
  dirty,
}: {
  fixtureTypes: FixtureType[];
  logLine: string;
  dirty: boolean;
}) {
  const modes = fixtureTypes.reduce((sum, item) => sum + item.modes.length, 0);
  const channels = fixtureTypes.reduce((sum, item) => sum + Math.max(0, ...item.modes.map((mode) => mode.channels)), 0);

  return (
    <div className="lx-panel" style={{ display: "grid", gridTemplateRows: "1fr auto", padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <Metric label="GDTF" value={fixtureTypes.length} />
        <Metric label="Modes" value={modes} />
        <Metric label="MaxCh" value={channels} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
        <Check size={12} style={{ color: dirty ? "var(--lx-accent-bright)" : "var(--lx-action-bright)" }} />
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "82px minmax(0, 1fr)",
        gap: 8,
        color: "var(--lx-fg-tertiary)",
        fontSize: 11,
      }}
    >
      <span>{label}</span>
      <span className="lx-code" style={{ overflow: "hidden", color: "var(--lx-fg-secondary)", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>
        {value}
      </span>
    </div>
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

function entryToDraft(fixtureType: FixtureType): FixtureTypeDraft {
  return {
    name: fixtureType.name,
    manufacturer: fixtureType.manufacturer,
    shortName: fixtureType.shortName || fixtureType.name,
    longName: fixtureType.longName || fixtureType.name,
    description: fixtureType.description,
    modes: fixtureType.modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      channels: mode.channels,
      attributes: mode.attributes.length ? mode.attributes : ["Dimmer"],
    })),
  };
}

function normalizeDraft(value: FixtureTypeDraft): FixtureTypeDraft {
  return {
    ...value,
    name: value.name.trim() || "New Fixture Type",
    manufacturer: value.manufacturer.trim() || "Custom",
    shortName: value.shortName.trim() || value.name.trim() || "New",
    longName: value.longName.trim() || value.name.trim() || "New Fixture Type",
    modes: value.modes.length
      ? value.modes.map((mode) => ({
          ...mode,
          name: mode.name.trim() || "Default",
          channels: clampChannelCount(mode.channels),
          attributes: mode.attributes.length ? mode.attributes : ["Dimmer"],
        }))
      : DEFAULT_DRAFT.modes,
  };
}

function summarizeDraftAttributes(value: FixtureTypeDraft): AttributeGroup[] {
  const counts = new Map<string, number>();
  for (const mode of value.modes) {
    for (const attribute of mode.attributes) {
      const group = inferAttributeGroup(attribute);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([name, count]) => ({
    id: name.toLowerCase(),
    name,
    count,
    encoderPage: `${name} 1 of ${Math.max(1, Math.ceil(count / 4))}`,
  }));
}

function parseAttributeList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferAttributeGroup(attribute: string) {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt") || lower.includes("position")) return "Position";
  if (lower.includes("color") || lower.includes("colour") || lower.includes("rgb")) return "Color";
  if (lower.includes("gobo")) return "Gobo";
  if (lower.includes("beam") || lower.includes("prism") || lower.includes("focus") || lower.includes("zoom") || lower.includes("frost")) return "Beam";
  if (lower.includes("dim") || lower.includes("shutter") || lower.includes("strobe")) return "Dimmer";
  return "Control";
}

function getChannelRange(fixtureType: FixtureType): string {
  const channels = fixtureType.modes.map((mode) => mode.channels);
  const min = Math.min(...channels);
  const max = Math.max(...channels);
  return min === max ? String(min) : `${min}-${max}`;
}

function clampChannelCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(512, Math.floor(value)));
}

function nextFixtureName(fixtureTypes: FixtureType[]) {
  return `New Fixture Type ${fixtureTypes.length + 1}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function errorToMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
