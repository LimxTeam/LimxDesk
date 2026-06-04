import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Clock3,
  Copy,
  FilePlus2,
  FolderOpen,
  HardDrive,
  Play,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { FloatingDialog } from "@limxdesk/ui";

interface ShowFileEntry {
  id: string;
  name: string;
  path: string;
  createdAtMs: number;
  modifiedAtMs: number;
  sizeBytes: number;
  formatVersion: number;
  appVersion: string;
}

interface LoadedShow {
  manifest: {
    id: string;
    name: string;
    formatVersion: number;
    createdAtMs: number;
    modifiedAtMs: number;
    appVersion: string;
  };
  path: string;
  sizeBytes: number;
}

export interface ShowFileDialogProps {
  open: boolean;
  onClose: () => void;
}

const OPERATIONS = [
  { id: "new", label: "新建", icon: FilePlus2, tone: "primary" },
  { id: "open", label: "打开", icon: FolderOpen, tone: "default" },
  { id: "load", label: "加载", icon: Play, tone: "action" },
  { id: "save", label: "保存", icon: Save, tone: "default" },
  { id: "saveAs", label: "另存为", icon: Copy, tone: "default" },
  { id: "delete", label: "删除", icon: Trash2, tone: "danger" },
] as const;

type OperationId = (typeof OPERATIONS)[number]["id"];

export function ShowFileDialog({ open, onClose }: ShowFileDialogProps) {
  const [shows, setShows] = useState<ShowFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [currentShow, setCurrentShow] = useState<LoadedShow | null>(null);
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<OperationId>("load");
  const [draftName, setDraftName] = useState(defaultShowName());
  const [libraryRoot, setLibraryRoot] = useState("C:/ProgramData/LimxDesk/Library/Show");
  const [activity, setActivity] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const selectedShow = shows.find((show) => show.path === selectedPath) ?? shows[0] ?? null;
  const filteredShows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return shows;
    return shows.filter((show) =>
      `${show.name} ${show.path} ${show.id}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query, shows]);

  useEffect(() => {
    if (!open) return;
    void refreshShows();
    void refreshCurrentShow();
  }, [open]);

  const refreshShows = async (preferredPath?: string) => {
    setBusy(true);
    try {
      const [root, entries] = await Promise.all([
        invoke<string>("show_library_root"),
        invoke<ShowFileEntry[]>("show_scan_library"),
      ]);
      setLibraryRoot(root);
      setShows(entries);

      const nextSelected =
        preferredPath && entries.some((show) => show.path === preferredPath)
          ? preferredPath
          : selectedPath && entries.some((show) => show.path === selectedPath)
            ? selectedPath
            : entries[0]?.path ?? "";
      setSelectedPath(nextSelected);
      setActivity(`Scanned ${entries.length} show file${entries.length === 1 ? "" : "s"}`);
    } catch (error) {
      setActivity(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshCurrentShow = async () => {
    try {
      setCurrentShow(await invoke<LoadedShow | null>("show_current"));
    } catch {
      setCurrentShow(null);
    }
  };

  const executeOperation = async () => {
    setBusy(true);
    try {
      switch (operation) {
        case "new": {
          const loaded = await invoke<LoadedShow>("show_create", { name: draftName });
          setCurrentShow(loaded);
          setDraftName(defaultShowName());
          await refreshShows(loaded.path);
          setActivity(`Created and loaded ${loaded.manifest.name}`);
          break;
        }
        case "open":
        case "load": {
          if (!selectedShow) {
            setActivity("No show selected");
            break;
          }
          const loaded = await invoke<LoadedShow>("show_load", { path: selectedShow.path });
          setCurrentShow(loaded);
          setActivity(`${operation === "open" ? "Opened" : "Loaded"} ${loaded.manifest.name}`);
          break;
        }
        case "save": {
          if (!selectedShow) {
            setActivity("No show selected");
            break;
          }
          const loaded = await invoke<LoadedShow>("show_save", { path: selectedShow.path });
          setCurrentShow(loaded);
          await refreshShows(loaded.path);
          setActivity(`Saved ${loaded.manifest.name}`);
          break;
        }
        case "saveAs": {
          if (!selectedShow) {
            setActivity("No show selected");
            break;
          }
          const saveAsName = draftName.trim() || `${selectedShow.name}_Copy`;
          const loaded = await invoke<LoadedShow>("show_save_as", {
            sourcePath: selectedShow.path,
            name: saveAsName,
          });
          setCurrentShow(loaded);
          setDraftName(defaultShowName());
          await refreshShows(loaded.path);
          setActivity(`Saved as ${loaded.manifest.name}`);
          break;
        }
        case "delete": {
          if (!selectedShow) {
            setActivity("No show selected");
            break;
          }
          await invoke<void>("show_delete", { path: selectedShow.path });
          setCurrentShow((current) => (current?.path === selectedShow.path ? null : current));
          await refreshShows();
          setActivity(`Deleted ${selectedShow.name}`);
          break;
        }
      }
    } catch (error) {
      setActivity(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FloatingDialog
      open={open}
      title="秀文件"
      subtitle="Show file operations"
      width={940}
      height={580}
      onClose={onClose}
    >
      <div
        style={{
          display: "grid",
          height: "100%",
          gridTemplateColumns: "170px minmax(0, 1fr) 300px",
          background: "var(--lx-bg-abyss)",
        }}
      >
        <aside
          style={{
            display: "grid",
            alignContent: "start",
            gap: 6,
            padding: 10,
            borderRight: "1px solid var(--lx-stroke)",
            background: "var(--lx-bg-deep)",
          }}
        >
          {OPERATIONS.map((item) => {
            const Icon = item.icon;
            const active = operation === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setOperation(item.id)}
                disabled={busy}
                style={{
                  display: "grid",
                  gridTemplateColumns: "22px minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 8,
                  height: 32,
                  border: active ? "1px solid var(--lx-primary-trace)" : "1px solid transparent",
                  borderRadius: "var(--lx-radius-sm)",
                  background: active ? "var(--lx-primary-dim)" : "transparent",
                  color: active ? "var(--lx-primary-bright)" : getOperationColor(item.tone),
                  padding: "0 8px",
                  textAlign: "left",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                <Icon size={14} />
                <span style={{ color: active ? "var(--lx-fg-primary)" : "inherit", fontWeight: 700 }}>
                  {item.label}
                </span>
              </button>
            );
          })}

          <div className="lx-divider-h" />
          <button
            type="button"
            className="lx-btn lx-btn-ghost lx-btn-sm"
            onClick={() => void refreshShows()}
            disabled={busy}
            style={{ justifyContent: "flex-start" }}
          >
            <RefreshCw size={12} />
            刷新
          </button>
        </aside>

        <main
          style={{
            display: "grid",
            minWidth: 0,
            minHeight: 0,
            gridTemplateRows: "42px minmax(0, 1fr) 30px",
            borderRight: "1px solid var(--lx-stroke)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              borderBottom: "1px solid var(--lx-stroke)",
            }}
          >
            <Search size={14} style={{ color: "var(--lx-fg-tertiary)" }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索秀文件、路径、GUID..."
              className="lx-input lx-input-sm"
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ overflow: "auto" }}>
            {filteredShows.length === 0 ? (
              <EmptyState
                title="没有秀文件"
                description={`扫描目录：${libraryRoot}`}
              />
            ) : (
              filteredShows.map((show) => (
                <button
                  key={show.path}
                  type="button"
                  onClick={() => setSelectedPath(show.path)}
                  style={{
                    display: "grid",
                    width: "100%",
                    gridTemplateColumns: "minmax(0, 1fr) 108px",
                    gap: 12,
                    minHeight: 58,
                    alignItems: "center",
                    border: "none",
                    borderBottom: "1px solid var(--lx-stroke)",
                    background: selectedShow?.path === show.path ? "rgba(0,120,212,0.16)" : "transparent",
                    color: "var(--lx-fg-secondary)",
                    padding: "8px 12px",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                    <span style={{ color: "var(--lx-fg-primary)", fontWeight: 800 }}>
                      {show.name}
                    </span>
                    <span
                      className="lx-code"
                      style={{
                        overflow: "hidden",
                        color: "var(--lx-fg-tertiary)",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={show.path}
                    >
                      {show.path}
                    </span>
                  </span>
                  <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                    <span className="lx-badge lx-badge-info">v{show.formatVersion}</span>
                    <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
                      {formatDate(show.modifiedAtMs)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div
            className="lx-code"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 10px",
              borderTop: "1px solid var(--lx-stroke)",
              color: "var(--lx-fg-tertiary)",
              fontSize: 10,
            }}
          >
            <Clock3 size={12} />
            {busy ? "Working..." : activity}
          </div>
        </main>

        <aside style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", minHeight: 0 }}>
          <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
            <PanelTitle title="操作目标" />
            <Field label="名称">
              <input
                className="lx-input lx-input-sm"
                value={operation === "new" || operation === "saveAs" ? draftName : selectedShow?.name ?? ""}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                readOnly={operation !== "new" && operation !== "saveAs"}
                placeholder="Show_Name"
              />
            </Field>
            <InfoRow label="目录" value={libraryRoot} />
            <InfoRow label="后缀" value=".limxdsek" />

            <div className="lx-divider-h" />
            <PanelTitle title="当前选择" />
            <InfoRow label="Show" value={selectedShow?.name ?? "-"} />
            <InfoRow label="GUID" value={selectedShow?.id ?? "-"} />
            <InfoRow label="Path" value={selectedShow?.path ?? "-"} />
            <InfoRow label="Modified" value={selectedShow ? formatDate(selectedShow.modifiedAtMs) : "-"} />
            <InfoRow label="Size" value={selectedShow ? formatBytes(selectedShow.sizeBytes) : "-"} />

            <div className="lx-divider-h" />
            <PanelTitle title="已加载" />
            <InfoRow label="Show" value={currentShow?.manifest.name ?? "-"} />
            <InfoRow label="GUID" value={currentShow?.manifest.id ?? "-"} />
            <InfoRow label="Path" value={currentShow?.path ?? "-"} />

            <div className="lx-panel-compact" style={{ display: "grid", gap: 7 }}>
              <div style={{ display: "flex", gap: 7, color: "var(--lx-fg-secondary)" }}>
                <HardDrive size={13} />
                <span style={{ fontWeight: 700 }}>Show Library</span>
              </div>
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                {shows.length} encrypted file{shows.length === 1 ? "" : "s"} indexed
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: 12,
              borderTop: "1px solid var(--lx-stroke)",
              background: "var(--lx-bg-deep)",
            }}
          >
            <button type="button" className="lx-btn lx-btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="lx-btn lx-btn-primary" onClick={() => void executeOperation()} disabled={busy}>
              执行
            </button>
          </div>
        </aside>
      </div>
    </FloatingDialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "54px minmax(0, 1fr)",
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
        gridTemplateColumns: "54px minmax(0, 1fr)",
        gap: 8,
        color: "var(--lx-fg-tertiary)",
        fontSize: 11,
      }}
    >
      <span>{label}</span>
      <span
        className="lx-code"
        style={{
          overflow: "hidden",
          color: "var(--lx-fg-secondary)",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        minHeight: 240,
        color: "var(--lx-fg-tertiary)",
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        <strong style={{ color: "var(--lx-fg-secondary)" }}>{title}</strong>
        <span className="lx-code" style={{ maxWidth: 420 }}>
          {description}
        </span>
      </div>
    </div>
  );
}

function PanelTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        color: "var(--lx-fg-primary)",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.04em",
      }}
    >
      {title}
    </div>
  );
}

function getOperationColor(tone: string) {
  if (tone === "danger") return "var(--lx-status-error)";
  if (tone === "action") return "var(--lx-action-bright)";
  if (tone === "primary") return "var(--lx-primary-bright)";
  return "var(--lx-fg-secondary)";
}

function defaultShowName() {
  const date = new Date();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `NewShow_${yyyy}_${mm}_${dd}_${hh}_${min}`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
