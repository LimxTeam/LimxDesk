import { useState } from "react";
import {
  Zap, Settings, FolderOpen, SlidersHorizontal, Group, GitBranch,
  ListOrdered, Monitor, HelpCircle, Filter,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "power",   icon: Zap, label: "" },
  { id: "setup",   icon: Settings, label: "" },
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
  const [active, setActive] = useState<string | null>(null);

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
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            title={item.id}
            style={{
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--lx-radius-sm)",
              background: isActive ? "var(--lx-primary-dim)" : "transparent",
              color: isActive ? "var(--lx-primary-bright)" : "var(--lx-fg-tertiary)",
              border: "none",
              cursor: "pointer",
              transition: "all var(--lx-duration-fast)",
            }}
          >
            <item.icon size={16} />
          </button>
        );
      })}
    </div>
  );
}
