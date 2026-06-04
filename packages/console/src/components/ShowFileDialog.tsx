import { useState } from "react";
import type { ReactNode } from "react";
import {
  Clock3,
  Copy,
  FileDown,
  FilePlus2,
  FolderOpen,
  HardDrive,
  Play,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { FloatingDialog } from "@limxdesk/ui";

interface ShowFile {
  id: string;
  name: string;
  path: string;
  modified: string;
  version: string;
  locked?: boolean;
}

export interface ShowFileDialogProps {
  open: boolean;
  onClose: () => void;
}

const INITIAL_SHOWS: ShowFile[] = [
  {
    id: "show-1",
    name: "NewShow_2026_06_04",
    path: "C:/Shows/NewShow_2026_06_04.lxshow",
    modified: "Today 23:18",
    version: "0.1",
  },
  {
    id: "show-2",
    name: "Festival_Main_Rig",
    path: "D:/ShowData/Festival_Main_Rig.lxshow",
    modified: "Yesterday 19:42",
    version: "0.1",
  },
  {
    id: "show-3",
    name: "House_Template",
    path: "C:/Shows/Templates/House_Template.lxshow",
    modified: "2026-05-30",
    version: "0.1",
    locked: true,
  },
];

const OPERATIONS = [
  { id: "new", label: "新建", icon: FilePlus2, tone: "primary" },
  { id: "open", label: "打开", icon: FolderOpen, tone: "default" },
  { id: "load", label: "加载", icon: Play, tone: "action" },
  { id: "save", label: "保存", icon: Save, tone: "default" },
  { id: "saveAs", label: "另存为", icon: Copy, tone: "default" },
  { id: "export", label: "导出", icon: FileDown, tone: "default" },
  { id: "delete", label: "删除", icon: Trash2, tone: "danger" },
] as const;

type OperationId = (typeof OPERATIONS)[number]["id"];

export function ShowFileDialog({ open, onClose }: ShowFileDialogProps) {
  const [shows, setShows] = useState(INITIAL_SHOWS);
  const [selectedId, setSelectedId] = useState(INITIAL_SHOWS[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [operation, setOperation] = useState<OperationId>("load");
  const [draftName, setDraftName] = useState("Untitled_Show");
  const [targetPath, setTargetPath] = useState("C:/Shows");
  const [activity, setActivity] = useState("Ready");

  const selectedShow = shows.find((show) => show.id === selectedId) ?? shows[0];
  const visibleShows = shows.filter((show) =>
    `${show.name} ${show.path}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const executeOperation = () => {
    switch (operation) {
      case "new": {
        const show: ShowFile = {
          id: `show-${Date.now()}`,
          name: draftName.trim() || "Untitled_Show",
          path: `${targetPath.replace(/\/$/, "")}/${draftName.trim() || "Untitled_Show"}.lxshow`,
          modified: "Now",
          version: "0.1",
        };
        setShows((current) => [show, ...current]);
        setSelectedId(show.id);
        setActivity(`Created ${show.name}`);
        break;
      }
      case "open":
        setActivity(selectedShow ? `Opened ${selectedShow.name}` : "No show selected");
        break;
      case "load":
        setActivity(selectedShow ? `Loaded ${selectedShow.name} into desk` : "No show selected");
        break;
      case "save":
        setShows((current) =>
          current.map((show) =>
            show.id === selectedShow?.id ? { ...show, modified: "Now" } : show,
          ),
        );
        setActivity(selectedShow ? `Saved ${selectedShow.name}` : "No show selected");
        break;
      case "saveAs": {
        if (!selectedShow) {
          setActivity("No show selected");
          break;
        }

        const show: ShowFile = {
          ...selectedShow,
          id: `show-${Date.now()}`,
          name: `${selectedShow.name}_Copy`,
          path: `${targetPath.replace(/\/$/, "")}/${selectedShow.name}_Copy.lxshow`,
          modified: "Now",
          locked: false,
        };
        setShows((current) => [show, ...current]);
        setSelectedId(show.id);
        setActivity(`Saved as ${show.name}`);
        break;
      }
      case "export":
        setActivity(selectedShow ? `Export prepared for ${selectedShow.name}` : "No show selected");
        break;
      case "delete":
        if (!selectedShow) {
          setActivity("No show selected");
          break;
        }
        if (selectedShow.locked) {
          setActivity(`${selectedShow.name} is locked`);
          break;
        }
        setShows((current) => {
          const next = current.filter((show) => show.id !== selectedShow.id);
          setSelectedId(next[0]?.id ?? "");
          return next;
        });
        setActivity(`Deleted ${selectedShow.name}`);
        break;
    }
  };

  return (
    <FloatingDialog
      open={open}
      title="秀文件"
      subtitle="Show file operations"
      width={900}
      height={560}
      onClose={onClose}
    >
      <div
        style={{
          display: "grid",
          height: "100%",
          gridTemplateColumns: "180px minmax(0, 1fr) 280px",
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
                }}
              >
                <Icon size={14} />
                <span style={{ color: active ? "var(--lx-fg-primary)" : "inherit", fontWeight: 700 }}>
                  {item.label}
                </span>
              </button>
            );
          })}
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
              placeholder="搜索秀文件..."
              className="lx-input lx-input-sm"
              style={{ flex: 1 }}
            />
          </div>

          <div style={{ overflow: "auto" }}>
            {visibleShows.map((show) => (
              <button
                key={show.id}
                type="button"
                onClick={() => setSelectedId(show.id)}
                style={{
                  display: "grid",
                  width: "100%",
                  gridTemplateColumns: "minmax(0, 1fr) 92px",
                  gap: 12,
                  minHeight: 54,
                  alignItems: "center",
                  border: "none",
                  borderBottom: "1px solid var(--lx-stroke)",
                  background: selectedId === show.id ? "rgba(0,120,212,0.16)" : "transparent",
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
                  >
                    {show.path}
                  </span>
                </span>
                <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                  <span className={`lx-badge ${show.locked ? "lx-badge-default" : "lx-badge-info"}`}>
                    {show.locked ? "Locked" : `v${show.version}`}
                  </span>
                  <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
                    {show.modified}
                  </span>
                </span>
              </button>
            ))}
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
            {activity}
          </div>
        </main>

        <aside style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", minHeight: 0 }}>
          <div style={{ display: "grid", alignContent: "start", gap: 10, overflow: "auto", padding: 12 }}>
            <PanelTitle title="目标" />
            <Field label="名称">
              <input
                className="lx-input lx-input-sm"
                value={operation === "new" ? draftName : selectedShow?.name ?? ""}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                readOnly={operation !== "new"}
              />
            </Field>
            <Field label="目录">
              <input
                className="lx-input lx-input-sm"
                value={targetPath}
                onChange={(event) => setTargetPath(event.currentTarget.value)}
              />
            </Field>

            <div className="lx-divider-h" />
            <PanelTitle title="当前秀文件" />
            <InfoRow label="Show" value={selectedShow?.name ?? "-"} />
            <InfoRow label="Path" value={selectedShow?.path ?? "-"} />
            <InfoRow label="Modified" value={selectedShow?.modified ?? "-"} />
            <InfoRow label="Version" value={selectedShow ? `v${selectedShow.version}` : "-"} />
            <InfoRow label="Lock" value={selectedShow?.locked ? "Locked" : "Editable"} />

            <div className="lx-panel-compact" style={{ display: "grid", gap: 7 }}>
              <div style={{ display: "flex", gap: 7, color: "var(--lx-fg-secondary)" }}>
                <HardDrive size={13} />
                <span style={{ fontWeight: 700 }}>ShowData</span>
              </div>
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                {shows.length} files indexed
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
            <button type="button" className="lx-btn lx-btn-primary" onClick={executeOperation}>
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
        gridTemplateColumns: "70px minmax(0, 1fr)",
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
