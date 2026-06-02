import { useState } from "react";
import {
  PanelLeftClose, PanelLeftOpen,
  Keyboard,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { CommandBar } from "./CommandBar";
import { ControlPanel } from "./ControlPanel";

/** 侧边栏宽度过渡 */
const SLIDE = "width 0.22s cubic-bezier(0.32, 0.72, 0, 1)";

export function ConsoleShell({ children }: { children?: React.ReactNode }) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

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
            <LeftSidebar />
          </div>
        </div>

        {/* 画布 */}
        <div style={{ flex: 1, background: "var(--lx-bg-void)", overflow: "hidden", minWidth: 0 }}>
          {children}
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
            <RightSidebar />
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
          height: 178,
          flexShrink: 0,
          borderTop: "1px solid var(--lx-stroke)",
          background: "var(--lx-bg-surface)",
        }}
      >
        <ControlPanel />
      </div>
    </div>
  );
}
