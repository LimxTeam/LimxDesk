import { useDeferredValue, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { dynamicIsland, type IslandType } from "@limxdesk/notifications";
import { FloatingDialog } from "@limxdesk/ui";
import {
  AlertTriangle,
  Check,
  Copy,
  Plus,
  Search,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { ResizableDataTable } from "../components/ResizableDataTable";
import type { DataTableColumn } from "../components/ResizableDataTable";

type PatchState = "patched" | "fid" | "overlap" | "overflow" | "unpatched";

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

interface PatchWizardDraft {
  fixtureTypePath: string;
  modeId: string;
  quantity: number;
  firstFid: number;
  namePrefix: string;
  channelId: number;
  universe: number;
  address: number;
  stage: string;
}

interface PatchDocument {
  fixtures: PatchFixture[];
}

interface PatchCommandResult {
  document: PatchDocument;
  selectedId: string | null;
  message: string;
}

const STAGES = ["Main", "Stage B", "Previs"];

export function ConnectivitySettingsPage() {
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stageFilter, setStageFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [logLine, setLogLine] = useState("Ready");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showLoaded, setShowLoaded] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedId) ?? fixtures[0];
  const visibleFixtures = fixtures.filter((fixture) => {
    const matchesStage = stageFilter === "All" || fixture.stage === stageFilter;
    const haystack = `${fixture.fid} ${fixture.name} ${fixture.fixtureTypeName} ${fixture.modeName} ${formatPatch(fixture)}`.toLowerCase();
    return matchesStage && haystack.includes(deferredQuery);
  });
  const stats = getPatchStats(fixtures);
  const universes = getUniverseStats(fixtures);

  useEffect(() => {
    void refreshFixtureTypes();
    void loadPatchFromShow();
  }, []);

  const loadPatchFromShow = async () => {
    setBusy(true);
    try {
      const document = await invoke<PatchDocument | null>("patch_load_current_show");
      if (!document) {
        setShowLoaded(false);
        setFixtures([]);
        setSelectedId("");
        showPatchNotice("warning", "没有加载秀文件", "请先新建或加载 show 文件");
        setLogLine("No show loaded. Create or load a show file before editing patch.");
        return;
      }

      const nextFixtures = Array.isArray(document.fixtures)
        ? document.fixtures.map((fixture) => normalizeFixture(fixture, fixtureTypes))
        : [];
      setShowLoaded(true);
      setFixtures(nextFixtures);
      setSelectedId(nextFixtures[0]?.id ?? "");
      setLogLine(`Loaded ${nextFixtures.length} patched fixture${nextFixtures.length === 1 ? "" : "s"} from show`);
    } catch (error) {
      const message = errorToMessage(error);
      setShowLoaded(false);
      setFixtures([]);
      setSelectedId("");
      showPatchNotice("error", "加载配接失败", message, 4200);
      setLogLine(message);
    } finally {
      setBusy(false);
    }
  };

  const refreshFixtureTypes = async () => {
    setBusy(true);
    try {
      const entries = await invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show");
      setFixtureTypes(entries);
      setLogLine((current) =>
        current.startsWith("No show loaded") || current.startsWith("Loaded ")
          ? current
          : `Loaded ${entries.length} show fixture type${entries.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      const message = errorToMessage(error);
      showPatchNotice("error", "加载灯具类型失败", message, 4200);
      setLogLine(message);
    } finally {
      setBusy(false);
    }
  };

  const updateSelected = (patch: Partial<PatchFixture>) => {
    if (!selectedFixture) return;
    if (!showLoaded) {
      showPatchNotice("warning", "无法编辑配接", "请先新建或加载 show 文件");
      setLogLine("No show loaded. Patch changes are blocked.");
      return;
    }

    void runPatchCommand(
      () => invoke<PatchCommandResult>("patch_update_fixture", { id: selectedFixture.id, patch }),
      "正在保存配接",
    );
  };

  const applyWizard = async (draft: PatchWizardDraft) => {
    const fixtureType = fixtureTypes.find((item) => item.path === draft.fixtureTypePath);
    const mode = fixtureType?.modes.find((item) => item.id === draft.modeId) ?? fixtureType?.modes[0];
    if (!fixtureType || !mode) {
      showPatchNotice("warning", "无法应用配接", "没有可用的 GDTF 灯具类型");
      setLogLine("No GDTF fixture type selected");
      return;
    }

    const saved = await runPatchCommand(
      () => invoke<PatchCommandResult>("patch_apply_wizard", { fixtureType, draft: normalizeWizardDraft(draft) }),
      "正在应用配接",
    );
    if (saved) {
      setWizardOpen(false);
    }
  };

  const duplicateFixture = () => {
    if (!selectedFixture) return;
    if (!showLoaded) {
      showPatchNotice("warning", "无法复制配接", "请先新建或加载 show 文件");
      setLogLine("No show loaded. Patch changes are blocked.");
      return;
    }

    void runPatchCommand(
      () => invoke<PatchCommandResult>("patch_duplicate_fixture", { id: selectedFixture.id }),
      "正在复制配接",
    );
  };

  const deleteFixture = () => {
    if (!selectedFixture) return;
    if (!showLoaded) {
      showPatchNotice("warning", "无法删除配接", "请先新建或加载 show 文件");
      setLogLine("No show loaded. Patch changes are blocked.");
      return;
    }

    void runPatchCommand(
      () => invoke<PatchCommandResult>("patch_delete_fixture", { id: selectedFixture.id }),
      "正在删除配接",
    );
  };

  const autoPatch = () => {
    if (!showLoaded) {
      showPatchNotice("warning", "无法自动配接", "请先新建或加载 show 文件");
      setLogLine("No show loaded. Patch changes are blocked.");
      return;
    }

    void runPatchCommand(
      () => invoke<PatchCommandResult>("patch_auto_patch"),
      "正在自动配接",
    );
  };

  const runPatchCommand = async (
    command: () => Promise<PatchCommandResult>,
    loadingTitle: string,
  ): Promise<boolean> => {
    setBusy(true);
    const islandId = dynamicIsland.show({
      type: "loading",
      title: loadingTitle,
      subtitle: "写入当前 show 文件",
      glow: true,
    });
    try {
      const result = await command();
      const nextFixtures = result.document.fixtures.map((fixture) => normalizeFixture(fixture, fixtureTypes));
      setFixtures(nextFixtures);
      setSelectedId(result.selectedId ?? nextFixtures[0]?.id ?? "");
      setShowLoaded(true);
      setLogLine(result.message);
      dynamicIsland.update(islandId, {
        type: "success",
        title: "配接已保存",
        subtitle: result.message,
        progress: 1,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 1800);
      return true;
    } catch (error) {
      const errorMessage = errorToMessage(error);
      setLogLine(errorMessage);
      dynamicIsland.update(islandId, {
        type: "error",
        title: "保存配接失败",
        subtitle: errorMessage,
        progress: 0,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 4600);
      return false;
    } finally {
      setBusy(false);
    }
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
          <button type="button" className="lx-btn lx-btn-primary" onClick={() => setWizardOpen(true)} disabled={busy || fixtureTypes.length === 0}>
            <Plus size={13} />
            添加配接
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={duplicateFixture} disabled={!showLoaded || !selectedFixture}>
            <Copy size={13} />
            复制
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={autoPatch} disabled={!showLoaded || fixtures.length === 0}>
            <WandSparkles size={13} />
            自动配接
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={deleteFixture} disabled={!showLoaded || !selectedFixture}>
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
        <PatchTable fixtures={visibleFixtures} allFixtures={fixtures} selectedId={selectedId} onSelect={setSelectedId} />
        <Inspector fixture={selectedFixture} fixtureTypes={fixtureTypes} disabled={!showLoaded || busy} onChange={updateSelected} />
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
        <StatusPanel stats={stats} logLine={!showLoaded ? logLine : fixtureTypes.length === 0 ? "No show fixture types. Import one first." : logLine} />
      </div>

      <PatchWizardDialog
        open={wizardOpen}
        fixtureTypes={fixtureTypes}
        fixtures={fixtures}
        defaultStage={stageFilter === "All" ? "Main" : stageFilter}
        onClose={() => setWizardOpen(false)}
        onApply={applyWizard}
      />
    </div>
  );
}

function PatchWizardDialog({
  open,
  fixtureTypes,
  fixtures,
  defaultStage,
  onClose,
  onApply,
}: {
  open: boolean;
  fixtureTypes: FixtureTypeEntry[];
  fixtures: PatchFixture[];
  defaultStage: string;
  onClose: () => void;
  onApply: (draft: PatchWizardDraft) => void;
}) {
  const firstType = fixtureTypes[0];
  const [draft, setDraft] = useState<PatchWizardDraft>(() => createWizardDraft(firstType, fixtures, defaultStage));

  useEffect(() => {
    if (!open) return;
    setDraft(createWizardDraft(firstType, fixtures, defaultStage));
  }, [defaultStage, firstType, fixtures, open]);

  const fixtureType = fixtureTypes.find((item) => item.path === draft.fixtureTypePath) ?? firstType;
  const mode = fixtureType?.modes.find((item) => item.id === draft.modeId) ?? fixtureType?.modes[0];
  const preview = fixtureType && mode ? previewPatch(draft, fixtureType, mode) : [];
  const issues = getBatchIssues(fixtures, preview);
  const issueCount = preview.filter((item) => getFixtureIssues([...fixtures, ...preview], item).length > 0).length;

  const updateDraft = (patch: Partial<PatchWizardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <FloatingDialog open={open} title="Fixture Wizard" subtitle="批量添加配接" width={930} height={610} onClose={onClose}>
      <div
        style={{
          display: "grid",
          height: "100%",
          gridTemplateColumns: "360px minmax(0, 1fr)",
          background: "var(--lx-bg-abyss)",
        }}
      >
        <div style={{ display: "grid", alignContent: "start", gap: 10, padding: 12, borderRight: "1px solid var(--lx-stroke)", background: "var(--lx-bg-deep)" }}>
          <WizardField label="Fixture Type">
            <select
              className="lx-input lx-input-sm"
              value={draft.fixtureTypePath}
              onChange={(event) => {
                const nextType = fixtureTypes.find((item) => item.path === event.currentTarget.value);
                updateDraft({
                  fixtureTypePath: event.currentTarget.value,
                  modeId: nextType?.modes[0]?.id ?? "",
                  namePrefix: nextType?.name ?? draft.namePrefix,
                });
              }}
            >
              {fixtureTypes.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.manufacturer} {item.name}
                </option>
              ))}
            </select>
          </WizardField>

          <WizardField label="Mode">
            <select className="lx-input lx-input-sm" value={draft.modeId} onChange={(event) => updateDraft({ modeId: event.currentTarget.value })}>
              {fixtureType?.modes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.channels}ch)
                </option>
              ))}
            </select>
          </WizardField>

          <div className="lx-divider-h" />

          <WizardField label="Name">
            <input className="lx-input lx-input-sm" value={draft.namePrefix} onChange={(event) => updateDraft({ namePrefix: event.currentTarget.value })} />
          </WizardField>
          <WizardField label="Quantity">
            <input className="lx-input lx-input-sm" type="number" min={1} max={4096} value={draft.quantity} onChange={(event) => updateDraft({ quantity: Number(event.currentTarget.value) })} />
          </WizardField>
          <WizardField label="Fixture ID">
            <input className="lx-input lx-input-sm" type="number" min={1} value={draft.firstFid} onChange={(event) => updateDraft({ firstFid: Number(event.currentTarget.value) })} />
          </WizardField>
          <WizardField label="Channel ID">
            <input className="lx-input lx-input-sm" type="number" min={0} value={draft.channelId} onChange={(event) => updateDraft({ channelId: Number(event.currentTarget.value) })} />
          </WizardField>

          <div className="lx-divider-h" />

          <WizardField label="Universe">
            <input className="lx-input lx-input-sm" type="number" min={1} max={1024} value={draft.universe} onChange={(event) => updateDraft({ universe: Number(event.currentTarget.value) })} />
          </WizardField>
          <WizardField label="Address">
            <input className="lx-input lx-input-sm" type="number" min={1} max={512} value={draft.address} onChange={(event) => updateDraft({ address: Number(event.currentTarget.value) })} />
          </WizardField>
          <WizardField label="Stage">
            <select className="lx-input lx-input-sm" value={draft.stage} onChange={(event) => updateDraft({ stage: event.currentTarget.value })}>
              {STAGES.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </WizardField>

          <div className="lx-panel-compact" style={{ display: "grid", gap: 6, color: "var(--lx-fg-secondary)" }}>
            <span className="lx-code">Mode Width: {mode?.channels ?? 0} channels</span>
            <span className="lx-code">Preview: {preview.length} fixtures</span>
            <span className="lx-code" style={{ color: issueCount > 0 ? "var(--lx-status-error)" : "var(--lx-action-bright)" }}>
              Conflicts: {issueCount}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="lx-btn lx-btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="lx-btn lx-btn-primary" onClick={() => onApply(normalizeWizardDraft(draft))} disabled={!fixtureType || !mode}>
              Apply
            </button>
          </div>
        </div>

        <div style={{ display: "grid", minHeight: 0, gridTemplateRows: "34px minmax(0, 1fr)", overflow: "hidden" }}>
          <div className="lx-panel-header">
            <span>Patch Preview</span>
            <span className={`lx-badge ${issues.length > 0 ? "lx-badge-error" : "lx-badge-success"}`}>{issues.length > 0 ? "Conflict" : "Clean"}</span>
          </div>
          <div style={{ overflow: "auto" }}>
            {preview.map((fixture) => {
              const fixtureIssues = getFixtureIssues([...fixtures, ...preview], fixture);
              const conflict = fixtureIssues.length > 0;
              return (
                <div
                  key={fixture.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "68px 1fr 130px 70px 92px 92px",
                    gap: 10,
                    alignItems: "center",
                    minHeight: 34,
                    borderBottom: "1px solid var(--lx-stroke)",
                    padding: "0 10px",
                    color: "var(--lx-fg-secondary)",
                    background: conflict ? "rgba(231,72,86,0.10)" : "transparent",
                  }}
                >
                  <span className="lx-code">FID {fixture.fid}</span>
                  <span style={{ color: "var(--lx-fg-primary)", fontWeight: 700 }}>{fixture.name}</span>
                  <span>{fixture.modeName}</span>
                  <span className="lx-code">{fixture.channels}ch</span>
                  <span className="lx-code" style={{ color: conflict ? "var(--lx-status-error)" : "var(--lx-action-bright)" }}>
                    {formatPatch(fixture)}
                  </span>
                  <span className={`lx-badge ${conflict ? "lx-badge-error" : "lx-badge-success"}`}>
                    {fixtureIssues.length > 0 ? fixtureIssues.join("/") : "OK"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </FloatingDialog>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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
        style={{ width: "100%", border: "none", outline: "none", background: "transparent", color: "var(--lx-fg-primary)", fontSize: 12 }}
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
  const columns: Array<DataTableColumn<PatchFixture>> = [
    {
      id: "fid",
      label: "FID",
      width: 72,
      minWidth: 56,
      render: (fixture) => <span className="lx-code" style={{ color: "var(--lx-fg-primary)" }}>{fixture.fid}</span>,
    },
    {
      id: "name",
      label: "Name",
      width: 190,
      minWidth: 130,
      render: (fixture) => <span style={{ color: "var(--lx-fg-primary)", fontWeight: 650 }}>{fixture.name}</span>,
    },
    { id: "fixtureType", label: "Fixture Type", width: 210, minWidth: 150, render: (fixture) => fixture.fixtureTypeName },
    { id: "mode", label: "Mode", width: 150, minWidth: 110, render: (fixture) => fixture.modeName },
    { id: "channels", label: "Channels", width: 86, minWidth: 70, render: (fixture) => <span className="lx-code">{fixture.channels}</span> },
    { id: "patch", label: "Patch", width: 96, minWidth: 76, render: (fixture) => <span className="lx-code">{formatPatch(fixture)}</span> },
    { id: "stage", label: "Stage", width: 110, minWidth: 86, render: (fixture) => fixture.stage },
    { id: "state", label: "State", width: 116, minWidth: 100, render: (fixture) => <StateBadge state={getPatchStateForRange(fixture, allFixtures)} /> },
  ];

  return (
    <ResizableDataTable
      columns={columns}
      rows={fixtures}
      selectedId={selectedId}
      getRowId={(fixture) => fixture.id}
      onRowClick={(fixture) => onSelect(fixture.id)}
    />
  );
}

function Inspector({
  fixture,
  fixtureTypes,
  disabled,
  onChange,
}: {
  fixture?: PatchFixture;
  fixtureTypes: FixtureTypeEntry[];
  disabled: boolean;
  onChange: (patch: Partial<PatchFixture>) => void;
}) {
  if (!fixture) {
    return <div className="lx-panel" style={{ padding: 14, color: "var(--lx-fg-tertiary)" }}>没有选中灯具</div>;
  }

  const fixtureType = fixtureTypes.find((item) => item.path === fixture.fixtureTypePath);
  const modes = fixtureType?.modes ?? [{ id: fixture.modeId, name: fixture.modeName, channels: fixture.channels, attributes: [] }];

  return (
    <div className="lx-panel" style={{ display: "grid", minHeight: 0, gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <div className="lx-panel-header">
        <span>Fixture Inspector</span>
        <span className="lx-code">FID {fixture.fid}</span>
      </div>
      <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
        <Field label="FID">
          <input className="lx-input lx-input-sm" type="number" value={fixture.fid} disabled={disabled} onChange={(event) => onChange({ fid: Number(event.currentTarget.value) })} />
        </Field>
        <Field label="Name">
          <input className="lx-input lx-input-sm" value={fixture.name} disabled={disabled} onChange={(event) => onChange({ name: event.currentTarget.value })} />
        </Field>
        <Field label="Fixture Type">
          <select
            className="lx-input lx-input-sm"
            value={fixture.fixtureTypePath}
            disabled={disabled}
            onChange={(event) => {
              const nextType = fixtureTypes.find((item) => item.path === event.currentTarget.value);
              const nextMode = nextType?.modes[0];
              if (nextType && nextMode) {
                onChange({
                  fixtureTypeId: nextType.id,
                  fixtureTypeName: `${nextType.manufacturer} ${nextType.name}`.trim(),
                  fixtureTypePath: nextType.path,
                  modeId: nextMode.id,
                  modeName: nextMode.name,
                  channels: nextMode.channels,
                });
              }
            }}
          >
            {fixtureTypes.map((type) => (
              <option key={type.path} value={type.path}>{type.manufacturer} {type.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select
            className="lx-input lx-input-sm"
            value={fixture.modeId}
            disabled={disabled}
            onChange={(event) => {
              const nextMode = modes.find((mode) => mode.id === event.currentTarget.value);
              if (nextMode) onChange({ modeId: nextMode.id, modeName: nextMode.name, channels: nextMode.channels });
            }}
          >
            {modes.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.name} ({mode.channels}ch)</option>
            ))}
          </select>
        </Field>
        <Field label="Universe">
          <input className="lx-input lx-input-sm" type="number" min={1} value={fixture.universe ?? ""} disabled={disabled} onChange={(event) => onChange({ universe: nullableNumber(event.currentTarget.value) })} />
        </Field>
        <Field label="Address">
          <input className="lx-input lx-input-sm" type="number" min={1} max={512} value={fixture.address ?? ""} disabled={disabled} onChange={(event) => onChange({ address: nullableNumber(event.currentTarget.value) })} />
        </Field>
        <Field label="Stage">
          <select className="lx-input lx-input-sm" value={fixture.stage} disabled={disabled} onChange={(event) => onChange({ stage: event.currentTarget.value })}>
            {STAGES.map((stage) => <option key={stage}>{stage}</option>)}
          </select>
        </Field>
        <div className="lx-divider-h" />
        <ToggleRow label="Pan Invert" checked={fixture.panInvert} disabled={disabled} onChange={(panInvert) => onChange({ panInvert })} />
        <ToggleRow label="Tilt Invert" checked={fixture.tiltInvert} disabled={disabled} onChange={(tiltInvert) => onChange({ tiltInvert })} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", alignItems: "center", gap: 8, color: "var(--lx-fg-tertiary)", fontSize: 11 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function WizardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "104px minmax(0, 1fr)", alignItems: "center", gap: 8, color: "var(--lx-fg-tertiary)", fontSize: 11 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        height: 30,
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid var(--lx-stroke)",
        borderRadius: "var(--lx-radius-sm)",
        background: checked ? "var(--lx-primary-dim)" : "var(--lx-bg-deep)",
        color: disabled ? "var(--lx-fg-disabled)" : checked ? "var(--lx-primary-bright)" : "var(--lx-fg-secondary)",
        padding: "0 10px",
      }}
    >
      <span>{label}</span>
      {checked && <Check size={13} />}
    </button>
  );
}

function StageFilter({ value, onChange, stats }: { value: string; onChange: (value: string) => void; stats: ReturnType<typeof getPatchStats> }) {
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
              <div style={{ width: `${percent}%`, height: "100%", background: percent > 90 ? "var(--lx-status-error)" : percent > 70 ? "var(--lx-accent)" : "var(--lx-primary)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPanel({ stats, logLine }: { stats: ReturnType<typeof getPatchStats>; logLine: string }) {
  return (
    <div className="lx-panel" style={{ display: "grid", gridTemplateRows: "1fr auto", padding: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        <Metric label="Patched" value={stats.patched} />
        <Metric label="Open" value={stats.unpatched} />
        <Metric label="Fault" value={stats.fid + stats.overlap + stats.overflow} tone={stats.fid + stats.overlap + stats.overflow > 0 ? "var(--lx-status-error)" : undefined} />
      </div>
      <div className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>{logLine}</div>
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
  const label = state === "patched" ? "Patched" : state === "fid" ? "FID" : state === "overlap" ? "Overlap" : state === "overflow" ? "Overflow" : "Open";
  const className = state === "patched" ? "lx-badge-success" : state === "unpatched" ? "lx-badge-warn" : "lx-badge-error";

  return (
    <span className={`lx-badge ${className}`}>
      {(state === "fid" || state === "overlap" || state === "overflow") && <AlertTriangle size={10} />}
      {label}
    </span>
  );
}

function createWizardDraft(fixtureType: FixtureTypeEntry | undefined, fixtures: PatchFixture[], defaultStage: string): PatchWizardDraft {
  const nextPatch = findNextFreePatch(fixtures, fixtureType?.modes[0]?.channels ?? 1, 1, 1);
  return {
    fixtureTypePath: fixtureType?.path ?? "",
    modeId: fixtureType?.modes[0]?.id ?? "",
    quantity: 1,
    firstFid: getNextFid(fixtures),
    namePrefix: fixtureType?.name ?? "Fixture",
    channelId: 1,
    universe: nextPatch.universe,
    address: nextPatch.address,
    stage: defaultStage,
  };
}

function previewPatch(draft: PatchWizardDraft, fixtureType: FixtureTypeEntry, mode: FixtureTypeMode): PatchFixture[] {
  const normalized = normalizeWizardDraft(draft);
  const fixtures: PatchFixture[] = [];
  let cursorUniverse = normalized.universe;
  let cursorAddress = normalized.address;

  for (let index = 0; index < normalized.quantity; index += 1) {
    if (cursorAddress + mode.channels - 1 > 512) {
      cursorUniverse += 1;
      cursorAddress = 1;
    }

    fixtures.push({
      id: `preview-${index}`,
      fid: normalized.firstFid + index,
      name: `${normalized.namePrefix || fixtureType.name} ${normalized.channelId + index}`,
      fixtureTypeId: fixtureType.id,
      fixtureTypeName: `${fixtureType.manufacturer} ${fixtureType.name}`.trim(),
      fixtureTypePath: fixtureType.path,
      modeId: mode.id,
      modeName: mode.name,
      channels: mode.channels,
      universe: cursorUniverse,
      address: cursorAddress,
      stage: normalized.stage,
      panInvert: false,
      tiltInvert: false,
    });

    cursorAddress += mode.channels;
  }

  return fixtures;
}

function normalizeWizardDraft(draft: PatchWizardDraft): PatchWizardDraft {
  return {
    ...draft,
    quantity: clampQuantity(draft.quantity),
    firstFid: Math.max(1, Math.floor(draft.firstFid || 1)),
    channelId: Math.max(0, Math.floor(draft.channelId || 0)),
    universe: clampUniverse(draft.universe),
    address: clampAddress(draft.address),
    stage: STAGES.includes(draft.stage) ? draft.stage : "Main",
  };
}

function getPatchStats(fixtures: PatchFixture[]) {
  const byStage = fixtures.reduce<Record<string, number>>((acc, fixture) => {
    acc[fixture.stage] = (acc[fixture.stage] ?? 0) + 1;
    return acc;
  }, {});
  const states = fixtures.map((fixture) => getPatchStateForRange(fixture, fixtures));

  return {
    total: fixtures.length,
    patched: states.filter((state) => state === "patched").length,
    fid: states.filter((state) => state === "fid").length,
    overlap: states.filter((state) => state === "overlap").length,
    overflow: states.filter((state) => state === "overflow").length,
    unpatched: states.filter((state) => state === "unpatched").length,
    byStage,
  };
}

function getPatchStateForRange(fixture: PatchFixture, fixtures: PatchFixture[]): PatchState {
  if (hasFidConflict(fixtures, fixture)) return "fid";
  const range = getPatchRange(fixture);
  if (!range) return "unpatched";
  if (range.end > 512) return "overflow";
  return fixtures.some((item) => item.id !== fixture.id && rangesOverlap(range, getPatchRange(item))) ? "overlap" : "patched";
}

function getFixtureIssues(fixtures: PatchFixture[], fixture: PatchFixture): string[] {
  const issues: string[] = [];

  if (hasFidConflict(fixtures, fixture)) {
    issues.push("FID");
  }

  const range = getPatchRange(fixture);
  if (range) {
    if (range.end > 512) {
      issues.push("OVER");
    }

    if (fixtures.some((item) => item.id !== fixture.id && rangesOverlap(range, getPatchRange(item)))) {
      issues.push("ADDR");
    }
  }

  return issues;
}

function getBatchIssues(existing: PatchFixture[], batch: PatchFixture[]): string[] {
  const pool = [...existing, ...batch];
  const messages = new Set<string>();

  for (const fixture of batch) {
    const issues = getFixtureIssues(pool, fixture);
    if (issues.includes("FID")) {
      messages.add(`FID ${fixture.fid} already exists`);
    }
    if (issues.includes("ADDR")) {
      messages.add(`Address ${formatPatch(fixture)}-${fixture.address !== null ? fixture.address + fixture.channels - 1 : ""} is occupied`);
    }
    if (issues.includes("OVER")) {
      messages.add(`Address ${formatPatch(fixture)} exceeds universe size`);
    }
  }

  return Array.from(messages);
}

function hasFidConflict(fixtures: PatchFixture[], fixture: PatchFixture) {
  return fixtures.some((item) => item.id !== fixture.id && item.fid === fixture.fid);
}

function hasRangeConflict(fixtures: PatchFixture[], fixture: PatchFixture) {
  const range = getPatchRange(fixture);
  if (!range || range.end > 512) return true;
  return fixtures.some((item) => rangesOverlap(range, getPatchRange(item)));
}

function getPatchRange(fixture: PatchFixture) {
  if (fixture.universe === null || fixture.address === null) return null;
  return {
    universe: fixture.universe,
    start: fixture.address,
    end: fixture.address + Math.max(1, fixture.channels) - 1,
  };
}

function rangesOverlap(left: ReturnType<typeof getPatchRange>, right: ReturnType<typeof getPatchRange>) {
  if (!left || !right) return false;
  if (left.universe !== right.universe) return false;
  return left.start <= right.end && right.start <= left.end;
}

function getUniverseStats(fixtures: PatchFixture[]) {
  const universeMap = new Map<number, number>();
  fixtures.forEach((fixture) => {
    const range = getPatchRange(fixture);
    if (!range) return;
    const used = Math.min(512, range.end) - range.start + 1;
    universeMap.set(range.universe, (universeMap.get(range.universe) ?? 0) + Math.max(0, used));
  });

  const maxUniverse = Math.max(4, ...Array.from(universeMap.keys()));
  return Array.from({ length: maxUniverse }, (_, index) => index + 1).map((universe) => ({
    universe,
    used: universeMap.get(universe) ?? 0,
  }));
}

function findNextFreePatch(fixtures: PatchFixture[], channels: number, startUniverse: number, startAddress: number) {
  let universe = clampUniverse(startUniverse);
  let address = clampAddress(startAddress);

  while (universe < 1024) {
    if (address + channels - 1 <= 512) {
      const candidate: PatchFixture = {
        id: "candidate",
        fid: 0,
        name: "",
        fixtureTypeId: "",
        fixtureTypeName: "",
        fixtureTypePath: "",
        modeId: "",
        modeName: "",
        channels,
        universe,
        address,
        stage: "Main",
        panInvert: false,
        tiltInvert: false,
      };
      if (!hasRangeConflict(fixtures, candidate)) return { universe, address };
    }

    address += 1;
    if (address > 512) {
      universe += 1;
      address = 1;
    }
  }

  return { universe: startUniverse, address: startAddress };
}

function getNextFid(fixtures: PatchFixture[]): number {
  const used = fixtures.map((fixture) => fixture.fid).filter(Number.isFinite);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

function normalizeFixture(fixture: PatchFixture, fixtureTypes: FixtureTypeEntry[]): PatchFixture {
  const fixtureType = fixtureTypes.find((item) => item.path === fixture.fixtureTypePath);
  const mode = fixtureType?.modes.find((item) => item.id === fixture.modeId);

  return {
    ...fixture,
    fid: Math.max(1, Math.floor(fixture.fid || 1)),
    channels: Math.max(1, mode?.channels ?? fixture.channels),
    modeName: mode?.name ?? fixture.modeName,
    universe: fixture.universe === null ? null : clampUniverse(fixture.universe),
    address: fixture.address === null ? null : clampAddress(fixture.address),
  };
}

function formatPatch(fixture: PatchFixture): string {
  if (fixture.universe === null || fixture.address === null) return "-";
  return `${fixture.universe}.${String(fixture.address).padStart(3, "0")}`;
}

function nullableNumber(value: string) {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampQuantity(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(4096, Math.floor(value)));
}

function clampUniverse(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(1024, Math.floor(value)));
}

function clampAddress(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(512, Math.floor(value)));
}

function errorToMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function showPatchNotice(type: IslandType, title: string, subtitle?: string, duration = 2600) {
  dynamicIsland.show({
    type,
    title,
    subtitle,
    duration,
  });
}
