import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type MouseEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// ═══════════════════════════════════════════════════════
// DropdownMenu — UE5 Cobalt 风格
// ═══════════════════════════════════════════════════════

export interface DropdownMenuProps {
  /** 触发按钮的内容（ReactNode） */
  trigger: ReactNode;
  /** 菜单面板的子内容（一组 DropdownMenuItem / DropdownMenuDivider） */
  children: ReactNode;
  /** 无障碍标签 */
  ariaLabel: string;
  /** 对齐方式 */
  align?: "left" | "right";
  /** 面板最小宽度 */
  panelMinWidth?: number;
  /** 触发按钮的 className */
  triggerClassName?: string;
  /** 触发按钮的内联样式 */
  triggerStyle?: CSSProperties;
  /** 打开态触发按钮的内联样式 */
  triggerActiveStyle?: CSSProperties;
}

export function DropdownMenu({
  trigger,
  children,
  ariaLabel,
  align = "left",
  panelMinWidth = 180,
  triggerClassName,
  triggerStyle,
  triggerActiveStyle,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Escape 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div ref={containerRef} className="relative inline-flex h-full">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={toggle}
        className={triggerClassName}
        style={open ? { ...triggerStyle, ...triggerActiveStyle } : triggerStyle}
      >
        {trigger}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={ariaLabel}
          className="absolute top-full z-[var(--lx-z-dropdown)] mt-1"
          style={{
            minWidth: panelMinWidth,
            [align === "right" ? "right" : "left"]: 0,
            background: "var(--lx-bg-surface)",
            border: "1px solid var(--lx-stroke-strong)",
            borderRadius: "var(--lx-radius-md)",
            boxShadow: "var(--lx-shadow-lg)",
            padding: "4px",
            animation: "lx-dropdown-in 120ms cubic-bezier(0.16, 1, 0.30, 1)",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DropdownMenuItem
// ═══════════════════════════════════════════════════════

export interface DropdownMenuItemProps {
  icon?: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function DropdownMenuItem({
  icon,
  label,
  shortcut,
  disabled = false,
  onClick,
}: DropdownMenuItemProps) {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!disabled && onClick) onClick();
  };

  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      onClick={handleClick}
      className="flex items-center gap-2 rounded-xs px-2.5 py-1.5 text-left transition-colors duration-75"
      style={{
        height: "28px",
        fontSize: "12px",
        color: disabled ? "var(--lx-fg-disabled)" : "var(--lx-fg-secondary)",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "var(--lx-primary-dim)";
          e.currentTarget.style.color = "var(--lx-primary-bright)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = disabled
          ? "var(--lx-fg-disabled)"
          : "var(--lx-fg-secondary)";
      }}
    >
      {icon && (
        <span className="flex-shrink-0 opacity-70" style={{ width: 14, display: "inline-flex", justifyContent: "center" }}>
          {icon}
        </span>
      )}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span
          className="flex-shrink-0 ml-4 text-[10.5px]"
          style={{
            color: "var(--lx-fg-tertiary)",
            fontFamily: "var(--lx-font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════
// DropdownMenuDivider
// ═══════════════════════════════════════════════════════

export function DropdownMenuDivider() {
  return (
    <div
      role="separator"
      className="mx-1 my-0.5 h-px"
      style={{ background: "var(--lx-stroke)" }}
    />
  );
}

// ═══════════════════════════════════════════════════════
// FloatingDialog — 主窗口内可拖拽弹窗
// ═══════════════════════════════════════════════════════

export interface FloatingDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
  children: ReactNode;
  onClose: () => void;
}

export function FloatingDialog({
  open,
  title,
  subtitle,
  width = 760,
  height = 520,
  children,
  onClose,
}: FloatingDialogProps) {
  const [position, setPosition] = useState(() => ({
    x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
  }));
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;

    setPosition({
      x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
    });
  }, [height, open, width]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - height - 8);
      const nextX = drag.originX + event.clientX - drag.startX;
      const nextY = drag.originY + event.clientY - drag.startY;

      setPosition({
        x: Math.min(maxX, Math.max(8, nextX)),
        y: Math.min(maxY, Math.max(8, nextY)),
      });
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [height, width]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--lx-z-modal)",
        pointerEvents: "none",
      }}
    >
      <div
        role="dialog"
        aria-modal="false"
        aria-label={title}
        style={{
          position: "absolute",
          left: position.x,
          top: position.y,
          width,
          height,
          display: "grid",
          gridTemplateRows: "34px minmax(0, 1fr)",
          overflow: "hidden",
          pointerEvents: "auto",
          border: "1px solid var(--lx-stroke-strong)",
          borderRadius: "var(--lx-radius-lg)",
          background:
            "linear-gradient(180deg, rgba(34,34,36,0.98), rgba(18,18,20,0.98))",
          boxShadow: "var(--lx-shadow-xl)",
        }}
      >
        <div
          onMouseDown={(event) => {
            if (event.button !== 0) return;

            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              originX: position.x,
              originY: position.y,
            };
            document.body.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            borderBottom: "1px solid var(--lx-stroke)",
            background:
              "linear-gradient(180deg, rgba(48,48,52,0.94), rgba(30,30,34,0.98))",
            cursor: "grab",
            paddingLeft: 12,
          }}
        >
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: "var(--lx-fg-primary)", fontSize: 12, fontWeight: 800 }}>
              {title}
            </span>
            {subtitle && (
              <span
                className="lx-code"
                style={{
                  color: "var(--lx-fg-tertiary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 10,
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              display: "grid",
              width: 42,
              height: "100%",
              placeItems: "center",
              border: "none",
              borderLeft: "1px solid var(--lx-stroke)",
              background: "transparent",
              color: "var(--lx-fg-tertiary)",
              cursor: "pointer",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "var(--lx-status-error)";
              event.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
              event.currentTarget.style.color = "var(--lx-fg-tertiary)";
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
