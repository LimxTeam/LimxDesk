import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dynamicIsland } from "@limxdesk/notifications";
import { FloatingDialog, NamedAppearanceEditor, NamedAppearanceTile } from "@limxdesk/ui";
import { createDefaultNamedAppearance, normalizeNamedAppearance, type NamedAppearance } from "@limxdesk/naming";
import {
  createViewSlotModels,
  layoutWindowToWorkspaceWindow,
  workspaceWindowToLayoutWindow,
  type LayoutDocument,
  type LayoutViewSlot,
  type ViewSlotModel,
} from "./workspace/layoutDocument";
import type { WorkspaceWindow } from "./workspace/types";

interface RightSidebarProps {
  windows: WorkspaceWindow[];
  onApplyWindows: (windows: WorkspaceWindow[]) => void;
  onClearWindows: () => void;
}

interface SlotMenuState {
  slot: ViewSlotModel;
  x: number;
  y: number;
}

interface SlotEditorState {
  slot: ViewSlotModel;
  mode: "save" | "edit";
  draft: NamedAppearance;
}

export function RightSidebar({
  windows,
  onApplyWindows,
  onClearWindows,
}: RightSidebarProps) {
  const [slots, setSlots] = useState<ViewSlotModel[]>(() => createViewSlotModels());
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [menu, setMenu] = useState<SlotMenuState | null>(null);
  const [editor, setEditor] = useState<SlotEditorState | null>(null);

  const savedCount = useMemo(() => slots.filter((slot) => slot.saved).length, [slots]);

  useEffect(() => {
    void loadSlots();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const events = await Promise.all([
        listen("layout:changed", () => void loadSlots(false)),
        listen("show:loaded", () => void loadSlots()),
        listen("show:deleted", () => {
          setSlots(createViewSlotModels());
          setActiveSlot(null);
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

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  async function loadSlots(showError = false) {
    try {
      const document = await invoke<LayoutDocument | null>("layout_load_current_show");
      setSlots(createViewSlotModels(document?.viewSlots ?? []));
    } catch (error) {
      setSlots(createViewSlotModels());
      if (showError) {
        showErrorIsland("视图槽位加载失败", errorToMessage(error));
      }
    }
  }

  function handleSlotClick(slot: ViewSlotModel) {
    setMenu(null);
    if (slot.saved) {
      onApplyWindows(slot.windows.map(layoutWindowToWorkspaceWindow));
      setActiveSlot(slot.id);
      showInfoIsland("视图已召回", `${slot.appearance.name} / ${slot.windows.length} windows`);
      return;
    }

    onClearWindows();
    setActiveSlot(null);
    showInfoIsland("当前视图已清空", `Slot ${slot.id} 为空`);
  }

  function openSaveEditor(slot: ViewSlotModel) {
    setMenu(null);
    setEditor({
      slot,
      mode: "save",
      draft: normalizeNamedAppearance(
        slot.saved ? slot.appearance : createDefaultNamedAppearance(`View ${slot.id}`),
        `View ${slot.id}`,
      ),
    });
  }

  function openEditEditor(slot: ViewSlotModel) {
    setMenu(null);
    if (!slot.saved) {
      openSaveEditor(slot);
      return;
    }
    setEditor({
      slot,
      mode: "edit",
      draft: normalizeNamedAppearance(slot.appearance, `View ${slot.id}`),
    });
  }

  async function saveEditor() {
    if (!editor) return;

    const snapshot =
      editor.mode === "save"
        ? windows.map(workspaceWindowToLayoutWindow)
        : editor.slot.windows;
    const slot: LayoutViewSlot = {
      id: editor.slot.id,
      appearance: normalizeNamedAppearance(editor.draft, `View ${editor.slot.id}`),
      windows: snapshot,
      updatedAtMs: Date.now(),
    };

    const islandId = dynamicIsland.show({
      type: "loading",
      title: editor.mode === "save" ? "正在保存视图" : "正在更新视图外观",
      subtitle: `Slot ${slot.id}`,
      glow: true,
    });

    try {
      const document = await invoke<LayoutDocument>("layout_save_view_slot", { slot });
      setSlots(createViewSlotModels(document.viewSlots));
      setActiveSlot(slot.id);
      setEditor(null);
      dynamicIsland.update(islandId, {
        type: "success",
        title: editor.mode === "save" ? "视图已保存" : "视图外观已更新",
        subtitle: `${slot.appearance.name} / ${slot.windows.length} windows`,
        progress: 1,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 1600);
    } catch (error) {
      dynamicIsland.update(islandId, {
        type: "error",
        title: "视图保存失败",
        subtitle: errorToMessage(error),
        progress: 0,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 4200);
    }
  }

  async function clearSlot(slot: ViewSlotModel) {
    setMenu(null);
    if (!slot.saved) return;

    try {
      const document = await invoke<LayoutDocument>("layout_clear_view_slot", {
        slotId: slot.id,
      });
      setSlots(createViewSlotModels(document.viewSlots));
      setActiveSlot((current) => (current === slot.id ? null : current));
      showInfoIsland("视图槽位已清空", `Slot ${slot.id}`);
    } catch (error) {
      showErrorIsland("视图槽位清空失败", errorToMessage(error));
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 7px",
          borderBottom: "1px solid var(--lx-stroke)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: "var(--lx-fg-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Views
        </span>
        <span
          style={{
            fontSize: 9,
            color: "var(--lx-fg-muted)",
            fontFamily: "var(--lx-font-mono)",
          }}
        >
          {savedCount}/18
        </span>
      </div>

      <div
        className="lx-hide-scrollbar"
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 3,
          padding: 4,
          overflowY: "auto",
          alignContent: "start",
          scrollbarWidth: "none",
        }}
      >
        {slots.map((slot) => {
          const isActive = activeSlot === slot.id;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => handleSlotClick(slot)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  slot,
                  x: Math.min(window.innerWidth - 180, event.clientX),
                  y: Math.min(window.innerHeight - 150, event.clientY),
                });
              }}
              title={
                slot.saved
                  ? `${slot.appearance.name} - 左键召回 | 右键菜单`
                  : `Slot ${slot.id} - 左键清空当前视图 | 右键保存当前视图`
              }
              style={{
                display: "block",
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <div style={{ position: "relative" }}>
                <NamedAppearanceTile
                  appearance={slot.appearance}
                  fallbackLabel={slot.saved ? slot.appearance.name : `${slot.id}`}
                  empty={!slot.saved}
                  active={isActive}
                  height={slot.saved ? 56 : 48}
                  compact
                />
                <span
                  className="lx-code"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 5,
                    color: isActive ? "var(--lx-primary-bright)" : "var(--lx-fg-muted)",
                    fontSize: 8,
                    fontWeight: 900,
                  }}
                >
                  {slot.id}
                </span>
                {slot.saved ? (
                  <span
                    className="lx-code"
                    style={{
                      position: "absolute",
                      left: 5,
                      bottom: 4,
                      color: "rgba(255,255,255,0.68)",
                      fontSize: 8,
                    }}
                  >
                    {slot.windows.length}w
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {menu ? (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            zIndex: "var(--lx-z-dropdown)",
            minWidth: 168,
            padding: 5,
            display: "grid",
            gap: 3,
            border: "1px solid var(--lx-stroke-strong)",
            borderRadius: "var(--lx-radius-md)",
            background: "var(--lx-bg-surface)",
            boxShadow: "var(--lx-shadow-lg)",
          }}
        >
          <MenuButton disabled={!menu.slot.saved} onClick={() => handleSlotClick(menu.slot)}>
            召回视图
          </MenuButton>
          <MenuButton onClick={() => openSaveEditor(menu.slot)}>
            保存当前视图...
          </MenuButton>
          <MenuButton disabled={!menu.slot.saved} onClick={() => openEditEditor(menu.slot)}>
            编辑命名外观...
          </MenuButton>
          <MenuButton danger disabled={!menu.slot.saved} onClick={() => clearSlot(menu.slot)}>
            清空槽位
          </MenuButton>
        </div>
      ) : null}

      <FloatingDialog
        open={Boolean(editor)}
        title={editor?.mode === "edit" ? "编辑视图命名" : "保存当前视图"}
        subtitle={editor ? `View Slot ${editor.slot.id}` : undefined}
        width={760}
        height={520}
        onClose={() => setEditor(null)}
      >
        {editor ? (
          <div style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) 44px", height: "100%" }}>
            <NamedAppearanceEditor
              title="View Naming"
              value={editor.draft}
              onChange={(draft) => setEditor((current) => (current ? { ...current, draft } : current))}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "0 12px",
                borderTop: "1px solid var(--lx-stroke)",
                background: "var(--lx-bg-deep)",
              }}
            >
              <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
                {editor.mode === "save"
                  ? `Snapshot: ${windows.length} current windows`
                  : `Stored: ${editor.slot.windows.length} windows`}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="lx-btn lx-btn-ghost" onClick={() => setEditor(null)}>
                  Cancel
                </button>
                <button type="button" className="lx-btn lx-btn-primary" onClick={saveEditor}>
                  {editor.mode === "save" ? "Save View" : "Update Appearance"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </FloatingDialog>
    </div>
  );
}

function MenuButton({
  children,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 28,
        border: "none",
        borderRadius: "var(--lx-radius-xs)",
        background: "transparent",
        color: disabled
          ? "var(--lx-fg-disabled)"
          : danger
            ? "#FFD4D9"
            : "var(--lx-fg-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        padding: "0 9px",
        fontSize: 11,
        fontWeight: 700,
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.background = danger
          ? "rgba(231,72,86,0.20)"
          : "var(--lx-primary-dim)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function showInfoIsland(title: string, subtitle: string) {
  const id = dynamicIsland.show({ type: "info", title, subtitle, duration: 1600 });
  window.setTimeout(() => dynamicIsland.hide(id), 1800);
}

function showErrorIsland(title: string, subtitle: string) {
  const id = dynamicIsland.show({ type: "error", title, subtitle, duration: 3800 });
  window.setTimeout(() => dynamicIsland.hide(id), 4200);
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
