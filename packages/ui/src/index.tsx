import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type MouseEvent,
  type CSSProperties,
} from "react";

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
