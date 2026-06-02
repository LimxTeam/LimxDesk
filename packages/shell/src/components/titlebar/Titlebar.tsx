import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  FilePlus2,
  FolderCog,
  FolderOpen,
  LogOut,
  Save,
} from "lucide-react";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from "@limxdesk/ui";
import { WindowControlButton } from "./WindowControlButton";

function callIsMaximized(): Promise<boolean> {
  return invoke<boolean>("titlebar_is_maximized");
}

export interface TitlebarProps {
  /** 是否已打开项目；控制菜单项状态 */
  hasActiveProject?: boolean;
  /** 当前项目名（可空）；非空时在标题栏中区居中显示 */
  projectName?: string | null;
  onProjectNew?: () => void;
  onProjectOpen?: () => void;
  onProjectSave?: () => void;
  onProjectClose?: () => void;
}

/** 自定义无边框标题栏 — UE5 Cobalt 风格 */
export function Titlebar({
  hasActiveProject = false,
  projectName = null,
  onProjectNew,
  onProjectOpen,
  onProjectSave,
  onProjectClose,
}: TitlebarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const updateMaximized = () => {
      callIsMaximized()
        .then(setIsMaximized)
        .catch(() => {
          /* 浏览器预览时静默忽略 */
        });
    };

    updateMaximized();
    window.addEventListener("resize", updateMaximized);
    return () => window.removeEventListener("resize", updateMaximized);
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-8 w-full shrink-0 select-none items-center"
      style={{
        backgroundColor: "var(--lx-bg-deep)",
        borderBottom: "1px solid var(--lx-stroke-glow)",
      }}
    >
      {/* ── 左区：品牌图标 + 名称 ─────────────────────────── */}
      <div
        data-tauri-drag-region
        className="flex h-full items-center gap-2 pl-2.5"
      >
        {/* UE5 风格 Logo 小方块 */}
        <div
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm select-none"
          style={{
            background: "linear-gradient(135deg, var(--lx-primary), var(--lx-primary-dim))",
            boxShadow: "0 0 8px var(--lx-primary-glow)",
          }}
          draggable={false}
        >
          <span
            className="text-[8px] font-black"
            style={{ color: "#FFFFFF" }}
          >
            L
          </span>
        </div>
        <span
          data-tauri-drag-region
          className="text-[10.5px] font-bold uppercase"
          style={{
            color: "var(--lx-fg-tertiary)",
            letterSpacing: "0.16em",
          }}
        >
          Limx
          <span
            style={{
              color: "var(--lx-primary-bright)",
              textShadow: "0 0 10px var(--lx-primary-glow)",
            }}
          >
            Desk
          </span>
        </span>
      </div>

      {/* ── 中区：可拖拽留白 + 当前项目名（居中） ─────────── */}
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center justify-center px-3"
      >
        {projectName && (
          <div
            data-tauri-drag-region
            className="flex max-w-[60%] items-center gap-2 truncate"
            title={projectName}
          >
            <span
              data-tauri-drag-region
              className="truncate text-[11.5px] font-semibold tracking-wide"
              style={{
                color: "var(--lx-fg-secondary)",
                textShadow: "0 0 8px rgba(0, 0, 0, 0.45)",
              }}
            >
              {projectName}
            </span>
          </div>
        )}
      </div>

      {/* ── 右区：项目菜单 / 窗口控制 ────────────────── */}
      <div className="flex h-full items-center">
        {hasActiveProject && (
          <>
            <DropdownMenu
              ariaLabel="项目菜单"
              align="right"
              panelMinWidth={220}
              triggerClassName={titlebarMenuButtonClass}
              triggerStyle={titlebarMenuButtonStyle}
              triggerActiveStyle={titlebarMenuButtonActiveStyle}
              trigger={
                <>
                  <FolderCog size={12} />
                  <span
                    className="text-[10.5px] font-bold uppercase"
                    style={{ letterSpacing: "0.14em" }}
                  >
                    项目
                  </span>
                  <ChevronDown size={10} style={{ opacity: 0.7 }} />
                </>
              }
            >
              <DropdownMenuItem
                icon={<FilePlus2 size={12} />}
                label="新建项目"
                shortcut="Ctrl+N"
                onClick={onProjectNew}
              />
              <DropdownMenuItem
                icon={<FolderOpen size={12} />}
                label="打开项目..."
                shortcut="Ctrl+O"
                onClick={onProjectOpen}
              />
              <DropdownMenuDivider />
              <DropdownMenuItem
                icon={<Save size={12} />}
                label="保存"
                shortcut="Ctrl+S"
                onClick={onProjectSave}
              />
              <DropdownMenuItem
                icon={<LogOut size={12} />}
                label="关闭项目"
                onClick={onProjectClose}
              />
            </DropdownMenu>

            {/* 与窗口控制按钮间的间隙线 */}
            <span
              aria-hidden
              className="mx-0.5 h-4 w-px"
              style={{ background: "var(--lx-stroke)" }}
            />
          </>
        )}

        <WindowControlButton type="minimize" isMaximized={isMaximized} />
        <WindowControlButton type="maximize" isMaximized={isMaximized} />
        <WindowControlButton type="close" isMaximized={isMaximized} />
      </div>

      {/* ── 底部辉光描边 ─────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--lx-primary-glow) 50%, transparent 100%)",
          opacity: 0.4,
        }}
      />
    </div>
  );
}

// ─────────────── 内联样式：标题栏按钮族 ───────────────

const titlebarMenuButtonClass =
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors duration-100";

const titlebarMenuButtonStyle = {
  color: "var(--lx-fg-tertiary)",
  background: "transparent",
} as const;

const titlebarMenuButtonActiveStyle = {
  color: "var(--lx-primary-bright)",
  background: "var(--lx-bg-elevated)",
} as const;
