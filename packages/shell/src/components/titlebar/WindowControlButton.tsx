import { useCallback } from "react";
import { Minus, Minimize2, Square, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

export type WindowControlType = "minimize" | "maximize" | "close";

export interface WindowControlButtonProps {
  type: WindowControlType;
  isMaximized: boolean;
}

function callMinimize(): Promise<void> {
  return invoke("titlebar_minimize");
}
function callMaximize(): Promise<void> {
  return invoke("titlebar_maximize");
}
function callClose(): Promise<void> {
  return invoke("titlebar_close");
}

export function WindowControlButton({
  type,
  isMaximized,
}: WindowControlButtonProps) {
  const handleClick = useCallback(() => {
    switch (type) {
      case "minimize":
        void callMinimize();
        break;
      case "maximize":
        void callMaximize();
        break;
      case "close":
        void callClose();
        break;
    }
  }, [type]);

  const isClose = type === "close";

  const icon = (() => {
    switch (type) {
      case "minimize":
        return <Minus size={14} />;
      case "maximize":
        return isMaximized ? <Minimize2 size={14} /> : <Square size={12} />;
      case "close":
        return <X size={14} />;
    }
  })();

  return (
    <button
      onClick={handleClick}
      aria-label={
        type === "minimize"
          ? "最小化"
          : type === "maximize"
            ? isMaximized
              ? "还原窗口"
              : "最大化"
            : "关闭"
      }
      className="inline-flex h-full w-[42px] items-center justify-center transition-colors duration-100"
      style={{ color: "var(--lx-fg-tertiary)" }}
      onMouseEnter={(e) => {
        if (isClose) {
          e.currentTarget.style.backgroundColor = "var(--lx-status-error)";
          e.currentTarget.style.color = "#FFFFFF";
        } else {
          e.currentTarget.style.backgroundColor = "rgba(0, 120, 212, 0.10)";
          e.currentTarget.style.color = "var(--lx-fg-primary)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--lx-fg-tertiary)";
      }}
    >
      {icon}
    </button>
  );
}
