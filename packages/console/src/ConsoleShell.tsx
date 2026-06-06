import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeNamedAppearance } from "@limxdesk/naming";
import {
  PanelLeftClose, PanelLeftOpen,
  Keyboard,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { CommandBar } from "./CommandBar";
import { ControlPanel } from "./ControlPanel";
import { WorkspaceCanvas, type WorkspaceCanvasHandle } from "./workspace/WorkspaceCanvas";
import { ShowFileDialog } from "./components/ShowFileDialog";
import { useConsoleCommandHandlers } from "./command/useConsoleCommandHandlers";
import {
  commandSlotNumber,
  commandSourceTargetSlotPair,
  getCommandRuntimeSnapshot,
  pushCommandHistory,
  registerCommandHandler,
  subscribeCommandRuntime,
  type DeskCommandState,
} from "./command/commandRuntime";
import {
  activeProgrammerValues,
  GROUP_SLOT_COUNT,
  PRESET_SLOT_COUNT,
  ensurePoolWindow,
  normalizeGroupSlots,
  normalizePresetSlots,
  replaceWindowConfig,
  type FixtureSelection,
  type GroupSlot,
  type PresetSlot,
  type Programmer,
  upsertById,
  upsertPreset,
} from "./workspace/poolRuntime";
import type { WorkspaceWindow } from "./workspace/types";

/** 侧边栏宽度过渡 */
const SLIDE = "width 0.22s cubic-bezier(0.32, 0.72, 0, 1)";
export function ConsoleShell({ children }: { children?: React.ReactNode }) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [showFileDialogOpen, setShowFileDialogOpen] = useState(false);
  const [workspaceWindows, setWorkspaceWindows] = useState<WorkspaceWindow[]>([]);
  const workspaceRef = useRef<WorkspaceCanvasHandle>(null);

  useEffect(() => {
    return registerCommandHandler("console-global-pools", async (command) => {
      if (command.target === "group") {
        return handleGlobalGroupCommand(command, workspaceRef);
      }
      if (command.target === "preset") {
        return handleGlobalPresetCommand(command, workspaceRef);
      }
      if (command.target === "sequence" || (!command.target && (command.mode === "store" || command.mode === "update"))) {
        ensureSequencePoolWindow(workspaceRef);
        return false;
      }
      return false;
    });
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCommandRuntime(() => {
      const command = getCommandRuntimeSnapshot();
      if (command.target === "sequence") {
        ensureSequencePoolWindow(workspaceRef);
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);
  useConsoleCommandHandlers();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* ── 上层：侧边栏 + 画布 ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左栏 — 宽度动画缩到 0 */}
        <div
          style={{
            width: leftCollapsed ? 0 : 50,
            minWidth: 0,
            overflow: "hidden",
            background: "var(--lx-bg-deep)",
            borderRight: leftCollapsed ? "none" : "1px solid var(--lx-stroke)",
            transition: SLIDE,
          }}
        >
          <div style={{ width: 50, height: "100%" }}>
            <LeftSidebar onOpenShowFiles={() => setShowFileDialogOpen(true)} />
          </div>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, background: "var(--lx-bg-void)", overflow: "hidden", minWidth: 0 }}>
          {children ?? (
            <WorkspaceCanvas
              ref={workspaceRef}
              onWindowsChange={setWorkspaceWindows}
            />
          )}
        </div>

        {/* 右栏 — 宽度动画缩到 0 */}
        <div
          style={{
            width: rightCollapsed ? 0 : 100,
            minWidth: 0,
            overflow: "hidden",
            background: "var(--lx-bg-deep)",
            borderLeft: rightCollapsed ? "none" : "1px solid var(--lx-stroke)",
            transition: SLIDE,
          }}
        >
          <div style={{ width: 100, height: "100%" }}>
            <RightSidebar
              windows={workspaceWindows}
              onApplyWindows={(windows) => workspaceRef.current?.applyWindows(windows)}
              onClearWindows={() => workspaceRef.current?.clearWindows()}
            />
          </div>
        </div>
      </div>

      {/* ── 命令栏 — 按钮始终固定宽度 ── */}
      <div
        style={{
          display: "flex",
          height: 32,
          flexShrink: 0,
          borderTop: "1px solid var(--lx-stroke)",
          background: "var(--lx-bg-deep)",
        }}
      >
        {/* 左折叠按钮 50px */}
        <button
          title={leftCollapsed ? "展开左侧边栏" : "折叠左侧边栏"}
          onClick={() => setLeftCollapsed((v) => !v)}
          style={{
            width: 50,
            height: "100%",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: leftCollapsed ? "var(--lx-primary-dim)" : "transparent",
            border: "none",
            borderRight: "1px solid var(--lx-stroke)",
            color: leftCollapsed ? "var(--lx-primary-bright)" : "var(--lx-fg-tertiary)",
            cursor: "pointer",
            transition: "all var(--lx-duration-fast)",
          }}
        >
          {leftCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>

        {/* 命令输入 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <CommandBar />
        </div>

        {/* 快捷键 + 右折叠 100px */}
        <div style={{ width: 100, height: "100%", flexShrink: 0, display: "flex", alignItems: "center" }}>
          <button
            title="启用快捷键"
            style={{
              flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", color: "var(--lx-fg-tertiary)", cursor: "pointer",
            }}
          >
            <Keyboard size={14} />
          </button>
          <button
            title={rightCollapsed ? "展开右侧边栏" : "折叠右侧边栏"}
            onClick={() => setRightCollapsed((v) => !v)}
            style={{
              flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
              background: rightCollapsed ? "var(--lx-primary-dim)" : "transparent",
              border: "none", borderLeft: "1px solid var(--lx-stroke)",
              color: rightCollapsed ? "var(--lx-primary-bright)" : "var(--lx-fg-tertiary)",
              cursor: "pointer", transition: "all var(--lx-duration-fast)",
            }}
          >
            {rightCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>
        </div>
      </div>

      {/* ── 控制面板 ── */}
      <div
        style={{
          height: 225,
          flexShrink: 0,
          borderTop: "1px solid var(--lx-stroke)",
          background: "var(--lx-bg-surface)",
        }}
      >
        <ControlPanel />
      </div>

      <ShowFileDialog
        open={showFileDialogOpen}
        onClose={() => setShowFileDialogOpen(false)}
      />
    </div>
  );
}

async function handleGlobalGroupCommand(
  command: DeskCommandState,
  workspaceRef: React.RefObject<WorkspaceCanvasHandle | null>,
) {
  const id = commandSlotNumber(command);
  if (!id || id < 1 || id > GROUP_SLOT_COUNT) {
    return { handled: true, keepCommand: true, status: "Group command needs a slot number" };
  }

  const snapshot = workspaceRef.current?.getWindows() ?? [];
  const { windows, window } = ensurePoolWindow(snapshot, "groups");
  const slots = normalizeGroupSlots(window.config.groups);
  const slot = slots.find((item) => item.id === id);

  if (command.mode === "store" || command.mode === "update") {
    const selection = await invoke<FixtureSelection>("fixture_selection_get");
    if (selection.fixtureIds.length === 0) {
      return { handled: true, keepCommand: true, status: "Select fixtures before storing a group" };
    }
    const nextSlot: GroupSlot = {
      id,
      appearance: normalizeNamedAppearance(slot?.appearance, `Group ${id}`),
      fixtureIds: selection.fixtureIds,
      primaryFixtureId: selection.primaryFixtureId,
    };
    commitPoolWindows(
      workspaceRef,
      `${command.mode === "update" ? "Update" : "Store"} Group ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, groups: upsertById(slots, nextSlot) }),
    );
    return { handled: true, status: `${command.mode === "update" ? "Updated" : "Stored"} Group ${id}` };
  }

  if (command.mode === "delete") {
    if (!slot) return { handled: true, keepCommand: true, status: `Group ${id} is empty` };
    commitPoolWindows(
      workspaceRef,
      `Delete Group ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, groups: slots.filter((item) => item.id !== id) }),
    );
    return { handled: true, status: `Deleted Group ${id}` };
  }

  if (command.mode === "copy" || command.mode === "move") {
    const pair = commandSourceTargetSlotPair(command, "group");
    if (!pair) return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Group needs source At destination` };
    const source = slots.find((item) => item.id === pair.source);
    if (!source) return { handled: true, keepCommand: true, status: `Group ${pair.source} is empty` };
    const nextSlot = {
      ...source,
      id: pair.target,
      appearance: normalizeNamedAppearance(source.appearance, `Group ${pair.target}`),
    };
    const withoutTarget = slots.filter((item) => item.id !== pair.target);
    const base = command.mode === "move" ? withoutTarget.filter((item) => item.id !== pair.source) : withoutTarget;
    commitPoolWindows(
      workspaceRef,
      `${command.mode === "copy" ? "Copy" : "Move"} Group ${pair.source} At ${pair.target}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, groups: upsertById(base, nextSlot) }),
    );
    return { handled: true, status: `${command.mode === "copy" ? "Copied" : "Moved"} Group ${pair.source} At ${pair.target}` };
  }

  if (command.mode === "edit") {
    commitPoolWindows(
      workspaceRef,
      `Edit Group ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, groupEditorId: id }),
    );
    return { handled: true, status: `Edit Group ${id}` };
  }

  if (command.mode === "select" || command.mode === "idle") {
    if (!slot) return { handled: true, keepCommand: true, status: `Group ${id} is empty` };
    await invoke("fixture_selection_select", {
      fixtureIds: slot.fixtureIds,
      primaryFixtureId: slot.primaryFixtureId ?? slot.fixtureIds[0] ?? null,
      mode: "replace",
    });
    return { handled: true, status: `Selected Group ${id}` };
  }

  return false;
}

function ensureSequencePoolWindow(workspaceRef: React.RefObject<WorkspaceCanvasHandle | null>) {
  const snapshot = workspaceRef.current?.getWindows() ?? [];
  const { windows } = ensurePoolWindow(snapshot, "sequence-pool");
  if (windows !== snapshot) {
    workspaceRef.current?.applyWindows(windows);
  }
}

async function handleGlobalPresetCommand(
  command: DeskCommandState,
  workspaceRef: React.RefObject<WorkspaceCanvasHandle | null>,
) {
  const id = commandSlotNumber(command);
  if (!id || id < 1 || id > PRESET_SLOT_COUNT) {
    return { handled: true, keepCommand: true, status: "Preset command needs a slot number" };
  }

  const snapshot = workspaceRef.current?.getWindows() ?? [];
  const { windows, window } = ensurePoolWindow(snapshot, "presets");
  const slots = normalizePresetSlots(window.config.presets);
  const slot = slots.find((item) => item.category === "all" && item.id === id);

  if (command.mode === "store" || command.mode === "update") {
    const programmer = await invoke<Programmer>("programmer_get");
    const values = activeProgrammerValues(programmer);
    if (values.length === 0) {
      return { handled: true, keepCommand: true, status: "No active programmer values to store" };
    }
    const nextSlot: PresetSlot = {
      id,
      category: "all",
      values,
      appearance: normalizeNamedAppearance(slot?.appearance, `All ${id}`),
    };
    commitPoolWindows(
      workspaceRef,
      `${command.mode === "update" ? "Update" : "Store"} Preset ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, presets: upsertPreset(slots, nextSlot) }),
    );
    return { handled: true, status: `${command.mode === "update" ? "Updated" : "Stored"} Preset ${id}` };
  }

  if (command.mode === "delete") {
    if (!slot) return { handled: true, keepCommand: true, status: `Preset ${id} is empty` };
    commitPoolWindows(
      workspaceRef,
      `Delete Preset ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, {
        ...window.config,
        presets: slots.filter((item) => !(item.category === "all" && item.id === id)),
      }),
    );
    return { handled: true, status: `Deleted Preset ${id}` };
  }

  if (command.mode === "copy" || command.mode === "move") {
    const pair = commandSourceTargetSlotPair(command, "preset");
    if (!pair) return { handled: true, keepCommand: true, status: `${command.mode.toUpperCase()} Preset needs source At destination` };
    const source = slots.find((item) => item.category === "all" && item.id === pair.source);
    if (!source) return { handled: true, keepCommand: true, status: `Preset ${pair.source} is empty` };
    const nextSlot = {
      ...source,
      id: pair.target,
      appearance: normalizeNamedAppearance(source.appearance, `All ${pair.target}`),
    };
    const withoutTarget = slots.filter((item) => !(item.category === "all" && item.id === pair.target));
    const base =
      command.mode === "move"
        ? withoutTarget.filter((item) => !(item.category === "all" && item.id === pair.source))
        : withoutTarget;
    commitPoolWindows(
      workspaceRef,
      `${command.mode === "copy" ? "Copy" : "Move"} Preset ${pair.source} At ${pair.target}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, presets: upsertPreset(base, nextSlot) }),
    );
    return { handled: true, status: `${command.mode === "copy" ? "Copied" : "Moved"} Preset ${pair.source} At ${pair.target}` };
  }

  if (command.mode === "edit") {
    commitPoolWindows(
      workspaceRef,
      `Edit Preset ${id}`,
      snapshot,
      replaceWindowConfig(windows, window.id, { ...window.config, presetEditorId: id }),
    );
    return { handled: true, status: `Edit Preset ${id}` };
  }

  if (command.mode === "select" || command.mode === "idle") {
    if (!slot) return { handled: true, keepCommand: true, status: `Preset ${id} is empty` };
    await Promise.all(
      slot.values
        .filter((value) => value.active)
        .map((value) =>
          invoke("programmer_set_attribute_for_selection", {
            request: {
              attribute: value.attribute,
              featureGroup: value.featureGroup,
              layer: value.layer,
              value: value.value,
              source: "preset",
            },
          }),
        ),
    );
    return { handled: true, status: `Recalled Preset ${id}` };
  }

  return false;
}

function commitPoolWindows(
  workspaceRef: React.RefObject<WorkspaceCanvasHandle | null>,
  label: string,
  previous: WorkspaceWindow[],
  next: WorkspaceWindow[],
) {
  workspaceRef.current?.applyWindows(next);
  pushCommandHistory({
    label,
    undo: () => workspaceRef.current?.applyWindows(previous),
    redo: () => workspaceRef.current?.applyWindows(next),
  });
}
