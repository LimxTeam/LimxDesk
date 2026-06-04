import {
  Zap, Settings, FolderOpen, SlidersHorizontal, Group, GitBranch,
  ListOrdered, Monitor, HelpCircle, Filter,
} from "lucide-react";
import { openSettingsWindow } from "@limxdesk/settings";

const NAV_ITEMS = [
  { id: "power",   icon: Zap, label: "" },
  { id: "setup",   icon: Settings, label: "", action: () => void openSettingsWindow() },
  { id: "library", icon: FolderOpen, label: "" },
  { id: "faders",  icon: SlidersHorizontal, label: "" },
  { id: "groups",  icon: Group, label: "" },
  { id: "chases",  icon: GitBranch, label: "" },
  { id: "cues",    icon: ListOrdered, label: "" },
  { id: "screen",  icon: Monitor, label: "" },
  { id: "help",    icon: HelpCircle, label: "" },
  { id: "filter",  icon: Filter, label: "" },
];

export function LeftSidebar() {
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
      {NAV_ITEMS.map((item) => {
        return (
          <button
            key={item.id}
            onClick={() => {
              item.action?.();
            }}
            title={item.id}
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
