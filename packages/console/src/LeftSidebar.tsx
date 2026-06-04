import {
  Zap, Settings, FolderOpen, SlidersHorizontal, Group, GitBranch,
  ListOrdered, Monitor, HelpCircle, Filter,
} from "lucide-react";
import { openSettingsWindow } from "@limxdesk/settings";

interface LeftSidebarProps {
  onOpenShowFiles?: () => void;
}

export function LeftSidebar({ onOpenShowFiles }: LeftSidebarProps) {
  const navItems = [
    { id: "power",   icon: Zap, label: "电源" },
    { id: "setup",   icon: Settings, label: "设置", action: () => void openSettingsWindow() },
    { id: "library", icon: FolderOpen, label: "秀文件", action: onOpenShowFiles },
    { id: "faders",  icon: SlidersHorizontal, label: "推杆" },
    { id: "groups",  icon: Group, label: "编组" },
    { id: "chases",  icon: GitBranch, label: "追逐" },
    { id: "cues",    icon: ListOrdered, label: "Cue" },
    { id: "screen",  icon: Monitor, label: "屏幕" },
    { id: "help",    icon: HelpCircle, label: "帮助" },
    { id: "filter",  icon: Filter, label: "过滤" },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        paddingTop: 4,
        gap: 2,
      }}
    >
      {navItems.map((item) => {
        return (
          <button
            key={item.id}
            onClick={() => {
              item.action?.();
            }}
            title={item.label}
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--lx-radius-sm)",
              background: "transparent",
              color: "var(--lx-fg-tertiary)",
              border: "none",
              cursor: "pointer",
              transition: "all var(--lx-duration-fast)",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "rgba(0, 120, 212, 0.10)";
              event.currentTarget.style.color = "var(--lx-primary-bright)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color = "var(--lx-fg-tertiary)";
            }}
          >
            <item.icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
