import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Minimize2, Square, X } from "lucide-react";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export interface WindowChromeProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  resizable?: boolean;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function getIsMaximized(): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  return getCurrentWindow().isMaximized();
}

export function WindowChrome({
  title,
  subtitle,
  children,
  resizable = true,
}: WindowChromeProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const updateMaximized = () => {
      void getIsMaximized().then(setIsMaximized).catch(() => setIsMaximized(false));
    };

    updateMaximized();
    window.addEventListener("resize", updateMaximized);
    return () => window.removeEventListener("resize", updateMaximized);
  }, []);

  const startDragging = (event: MouseEvent<HTMLDivElement>) => {
    if (!isTauriRuntime() || event.button !== 0 || event.detail > 1) {
      return;
    }

    void getCurrentWindow().startDragging();
  };

  const toggleMaximize = () => {
    if (!isTauriRuntime()) {
      return;
    }

    void getCurrentWindow()
      .toggleMaximize()
      .then(() => getIsMaximized())
      .then(setIsMaximized)
      .catch(() => undefined);
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100vw",
        height: "100vh",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--lx-bg-void)",
      }}
    >
      <div
        style={{
          display: "flex",
          height: 34,
          flexShrink: 0,
          alignItems: "center",
          borderBottom: "1px solid var(--lx-stroke-strong)",
          background:
            "linear-gradient(180deg, rgba(35, 35, 38, 0.98), rgba(22, 23, 27, 0.98))",
        }}
      >
        <div
          data-tauri-drag-region
          onMouseDown={startDragging}
          onDoubleClick={toggleMaximize}
          style={{
            display: "flex",
            minWidth: 0,
            height: "100%",
            flex: 1,
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            cursor: "default",
          }}
        >
          <div
            aria-hidden
            style={{
              display: "grid",
              width: 18,
              height: 18,
              flexShrink: 0,
              placeItems: "center",
              borderRadius: "var(--lx-radius-xs)",
              background:
                "linear-gradient(135deg, var(--lx-primary), rgba(77, 163, 245, 0.45))",
              boxShadow: "0 0 10px rgba(0, 120, 212, 0.28)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 900,
            }}
          >
            L
          </div>
          <div
            data-tauri-drag-region
            style={{
              display: "flex",
              minWidth: 0,
              flexDirection: "column",
              lineHeight: 1,
            }}
          >
            <span
              data-tauri-drag-region
              style={{
                overflow: "hidden",
                color: "var(--lx-fg-primary)",
                fontSize: 12,
                fontWeight: 800,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </span>
            {subtitle && (
              <span
                data-tauri-drag-region
                style={{
                  marginTop: 4,
                  overflow: "hidden",
                  color: "var(--lx-fg-tertiary)",
                  fontSize: 10,
                  fontWeight: 600,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", height: "100%", flexShrink: 0 }}>
          <ChromeButton type="minimize" isMaximized={isMaximized} />
          <ChromeButton type="maximize" isMaximized={isMaximized} onClick={toggleMaximize} />
          <ChromeButton type="close" isMaximized={isMaximized} />
        </div>
      </div>

      <div style={{ minHeight: 0, flex: 1 }}>{children}</div>

      {resizable && !isMaximized && <ResizeHandles />}
    </div>
  );
}

interface ChromeButtonProps {
  type: "minimize" | "maximize" | "close";
  isMaximized: boolean;
  onClick?: () => void;
}

function ChromeButton({ type, isMaximized, onClick }: ChromeButtonProps) {
  const close = type === "close";

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    switch (type) {
      case "minimize":
        void currentWindow.minimize();
        break;
      case "maximize":
        void currentWindow.toggleMaximize();
        break;
      case "close":
        void currentWindow.close();
        break;
    }
  };

  const icon =
    type === "minimize" ? (
      <Minus size={14} />
    ) : type === "maximize" ? (
      isMaximized ? <Minimize2 size={14} /> : <Square size={12} />
    ) : (
      <X size={14} />
    );

  return (
    <button
      type="button"
      aria-label={
        type === "minimize" ? "最小化" : type === "maximize" ? "最大化/还原" : "关闭"
      }
      onClick={handleClick}
      style={{
        display: "inline-flex",
        width: 44,
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        color: "var(--lx-fg-tertiary)",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = close
          ? "var(--lx-status-error)"
          : "rgba(255,255,255,0.06)";
        event.currentTarget.style.color = close ? "#fff" : "var(--lx-fg-primary)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = "var(--lx-fg-tertiary)";
      }}
    >
      {icon}
    </button>
  );
}

const resizeHandles: Array<{
  direction: ResizeDirection;
  style: CSSProperties;
}> = [
  { direction: "North", style: { top: 0, left: 8, right: 8, height: 5, cursor: "ns-resize" } },
  { direction: "South", style: { bottom: 0, left: 8, right: 8, height: 6, cursor: "ns-resize" } },
  { direction: "West", style: { top: 8, bottom: 8, left: 0, width: 5, cursor: "ew-resize" } },
  { direction: "East", style: { top: 8, bottom: 8, right: 0, width: 5, cursor: "ew-resize" } },
  { direction: "NorthWest", style: { top: 0, left: 0, width: 10, height: 10, cursor: "nwse-resize" } },
  { direction: "NorthEast", style: { top: 0, right: 0, width: 10, height: 10, cursor: "nesw-resize" } },
  { direction: "SouthWest", style: { bottom: 0, left: 0, width: 10, height: 10, cursor: "nesw-resize" } },
  { direction: "SouthEast", style: { bottom: 0, right: 0, width: 12, height: 12, cursor: "nwse-resize" } },
];

function ResizeHandles() {
  const startResize = (direction: ResizeDirection) => {
    if (!isTauriRuntime()) {
      return;
    }

    void getCurrentWindow().startResizeDragging(direction);
  };

  return (
    <>
      {resizeHandles.map((handle) => (
        <div
          key={handle.direction}
          aria-hidden
          onMouseDown={(event) => {
            if (event.button !== 0) {
              return;
            }

            event.preventDefault();
            startResize(handle.direction);
          }}
          style={{
            position: "absolute",
            zIndex: 60,
            ...handle.style,
          }}
        />
      ))}
    </>
  );
}
