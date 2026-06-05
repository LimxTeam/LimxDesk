import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type MouseEvent,
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  NAMING_COLOR_SWATCHES,
  normalizeNamedAppearance,
  type NamedAppearance,
} from "@limxdesk/naming";

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
// NamedAppearanceTile — 通用命名对象渲染
// ═══════════════════════════════════════════════════════

export interface NamedAppearanceTileProps {
  appearance: NamedAppearance;
  fallbackLabel: string;
  empty?: boolean;
  active?: boolean;
  height?: number;
  compact?: boolean;
}

export function NamedAppearanceTile({
  appearance,
  fallbackLabel,
  empty = false,
  active = false,
  height = 54,
  compact = false,
}: NamedAppearanceTileProps) {
  const normalized = normalizeNamedAppearance(appearance, fallbackLabel);
  const label = empty ? fallbackLabel : normalized.name || fallbackLabel;

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        height,
        minWidth: 0,
        overflow: "hidden",
        borderRadius: "var(--lx-radius-sm)",
        border: active
          ? `1px solid ${normalized.accentColor}`
          : empty
            ? "1px dashed var(--lx-stroke)"
            : "1px solid rgba(255,255,255,0.10)",
        background: empty
          ? "var(--lx-bg-deep)"
          : `linear-gradient(180deg, ${normalized.backgroundColor}, rgba(0,0,0,0.58))`,
        boxShadow: active ? `0 0 0 1px ${normalized.accentColor} inset` : undefined,
        color: empty ? "var(--lx-fg-muted)" : normalized.textColor,
      }}
    >
      {!empty && normalized.image ? (
        <img
          alt=""
          src={normalized.image.dataUrl}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: normalized.image.fit,
            opacity: normalized.image.opacity,
            transform: `translate(${normalized.image.offsetX}%, ${normalized.image.offsetY}%) scale(${normalized.image.scale}) rotate(${normalized.image.rotation}deg)`,
            transformOrigin: "center",
          }}
        />
      ) : null}
      {!empty && normalized.scribble ? (
        <svg
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          {normalized.scribble.paths.map((path, index) => (
            <path
              key={`${path}-${index}`}
              d={path}
              fill="none"
              stroke={normalized.scribble?.color}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={normalized.scribble?.opacity}
            />
          ))}
        </svg>
      ) : null}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gap: compact ? 1 : 3,
          justifyItems: "center",
          maxWidth: "100%",
          padding: "3px 5px",
          textShadow: empty ? undefined : "0 1px 4px rgba(0,0,0,0.9)",
        }}
      >
        <strong
          style={{
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: compact ? 10 : 12,
            lineHeight: 1.1,
            fontWeight: 900,
          }}
        >
          {label}
        </strong>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// NamedAppearanceEditor — 通用命名对象编辑器
// ═══════════════════════════════════════════════════════

export interface NamedAppearanceEditorProps {
  value: NamedAppearance;
  onChange: (value: NamedAppearance) => void;
  title?: string;
}

export function NamedAppearanceEditor({
  value,
  onChange,
  title = "命名外观",
}: NamedAppearanceEditorProps) {
  const appearance = normalizeNamedAppearance(value);
  const padRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const pathRef = useRef("");

  function update(patch: Partial<NamedAppearance>) {
    onChange(normalizeNamedAppearance({ ...appearance, ...patch }, appearance.name));
  }

  function updateImagePatch(patch: Partial<NonNullable<NamedAppearance["image"]>>) {
    if (!appearance.image) return;
    update({ image: { ...appearance.image, ...patch } });
  }

  function updateImage(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) return;
      update({
        image: {
          name: file.name,
          dataUrl,
          fit: appearance.image?.fit ?? "cover",
          opacity: appearance.image?.opacity ?? 0.55,
          scale: appearance.image?.scale ?? 1,
          offsetX: appearance.image?.offsetX ?? 0,
          offsetY: appearance.image?.offsetY ?? 0,
          rotation: appearance.image?.rotation ?? 0,
        },
      });
    });
    reader.readAsDataURL(file);
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * 1000) / 10,
      y: Math.round(((event.clientY - rect.top) / rect.height) * 600) / 10,
    };
  }

  function startScribble(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    drawingRef.current = true;
    pathRef.current = `M ${point.x} ${point.y}`;
  }

  function moveScribble(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    pathRef.current = `${pathRef.current} L ${point.x} ${point.y}`;
    update({
      scribble: {
        paths: [...(appearance.scribble?.paths ?? []), pathRef.current],
        color: appearance.scribble?.color ?? "#F5B84D",
        opacity: appearance.scribble?.opacity ?? 0.9,
      },
    });
  }

  function endScribble() {
    drawingRef.current = false;
    pathRef.current = "";
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "330px minmax(0, 1fr)",
        gap: 14,
        height: "100%",
        minHeight: 0,
        padding: 14,
        background: "var(--lx-bg-surface)",
      }}
    >
      <div style={editorPreviewPanelStyle}>
        <span
          style={{
            color: "var(--lx-fg-primary)",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
        <NamedAppearanceTile
          appearance={appearance}
          fallbackLabel="Preview"
          height={210}
        />
        <div style={editorMetaGridStyle}>
          <MetricBadge label="Image" value={appearance.image ? "ON" : "OFF"} />
          <MetricBadge label="Scribble" value={appearance.scribble ? `${appearance.scribble.paths.length}` : "OFF"} />
          <MetricBadge label="Name" value={`${appearance.name.length}/48`} />
        </div>
        <EditorSection title="Basic" subtitle="Identity and tile palette">
          <label style={editorFieldStyle}>
            <span style={editorLabelStyle}>Name</span>
            <input
              className="lx-input"
              value={appearance.name}
              maxLength={48}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </label>

          <div style={editorFieldStyle}>
            <span style={editorLabelStyle}>Background</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NAMING_COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`背景色 ${color}`}
                  onClick={() => update({ backgroundColor: color })}
                  style={{
                    width: 30,
                    height: 24,
                    borderRadius: "var(--lx-radius-xs)",
                    border:
                      appearance.backgroundColor.toLowerCase() === color.toLowerCase()
                        ? "2px solid var(--lx-fg-primary)"
                        : "1px solid var(--lx-stroke)",
                    background: color,
                  }}
                />
              ))}
              <input
                type="color"
                value={appearance.backgroundColor}
                onChange={(event) => update({ backgroundColor: event.currentTarget.value })}
                style={colorInputStyle}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={editorFieldStyle}>
              <span style={editorLabelStyle}>Text</span>
              <input
                type="color"
                value={appearance.textColor}
                onChange={(event) => update({ textColor: event.currentTarget.value })}
                style={wideColorInputStyle}
              />
            </label>
            <label style={editorFieldStyle}>
              <span style={editorLabelStyle}>Accent</span>
              <input
                type="color"
                value={appearance.accentColor}
                onChange={(event) => update({ accentColor: event.currentTarget.value })}
                style={wideColorInputStyle}
              />
            </label>
          </div>
        </EditorSection>
      </div>

      <div style={editorInspectorStyle}>
        <EditorSection title="Image Layer" subtitle={appearance.image?.name || "No image assigned"}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="lx-btn lx-btn-ghost" style={{ cursor: "pointer" }}>
              Choose Image
              <input
                type="file"
                accept="image/*"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  updateImage(event.currentTarget.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            {appearance.image ? (
              <>
                <button
                  type="button"
                  className="lx-btn lx-btn-ghost"
                  onClick={() =>
                    updateImagePatch({
                      scale: 1,
                      offsetX: 0,
                      offsetY: 0,
                      rotation: 0,
                    })
                  }
                >
                  Center
                </button>
                <button type="button" className="lx-btn lx-btn-ghost" onClick={() => update({ image: null })}>
                  Remove
                </button>
              </>
            ) : null}
          </div>

          {appearance.image ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "130px repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <label style={editorFieldStyle}>
                  <span style={editorLabelStyle}>Fit</span>
                  <select
                    className="lx-input lx-input-sm"
                    value={appearance.image.fit}
                    onChange={(event) =>
                      updateImagePatch({ fit: event.currentTarget.value === "contain" ? "contain" : "cover" })
                    }
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                  </select>
                </label>
                <NumberControl
                  label="Opacity"
                  value={appearance.image.opacity}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={(next) => updateImagePatch({ opacity: next })}
                />
                <NumberControl
                  label="Scale"
                  value={appearance.image.scale}
                  min={0.2}
                  max={3}
                  step={0.05}
                  onChange={(next) => updateImagePatch({ scale: next })}
                />
                <NumberControl
                  label="Rotation"
                  value={appearance.image.rotation}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(next) => updateImagePatch({ rotation: next })}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <NumberControl
                  label="Offset X"
                  value={appearance.image.offsetX}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(next) => updateImagePatch({ offsetX: next })}
                />
                <NumberControl
                  label="Offset Y"
                  value={appearance.image.offsetY}
                  min={-100}
                  max={100}
                  step={1}
                  onChange={(next) => updateImagePatch({ offsetY: next })}
                />
              </div>
            </div>
          ) : (
            <div style={emptyEditorHintStyle}>Use an image as the visual identity layer for this named object.</div>
          )}
        </EditorSection>

        <EditorSection title="Scribble Layer" subtitle="Draw a quick mark over the tile">
          <div
            ref={padRef}
            onPointerDown={startScribble}
            onPointerMove={moveScribble}
            onPointerUp={endScribble}
            onPointerCancel={endScribble}
            style={{
              position: "relative",
              height: 132,
              border: "1px solid var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))",
              overflow: "hidden",
              touchAction: "none",
              cursor: "crosshair",
            }}
          >
            <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              {appearance.scribble?.paths.map((path, index) => (
                <path
                  key={`${path}-${index}`}
                  d={path}
                  fill="none"
                  stroke={appearance.scribble?.color ?? "#F5B84D"}
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={appearance.scribble?.opacity ?? 0.9}
                />
              ))}
            </svg>
            <span
              style={{
                position: "absolute",
                left: 9,
                bottom: 7,
                color: "var(--lx-fg-muted)",
                fontSize: 10,
                pointerEvents: "none",
              }}
            >
              Draw here
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 8, alignItems: "end" }}>
            <label style={editorFieldStyle}>
              <span style={editorLabelStyle}>Color</span>
              <input
                type="color"
                value={appearance.scribble?.color ?? "#F5B84D"}
                onChange={(event) =>
                  update({
                    scribble: {
                      paths: appearance.scribble?.paths ?? [],
                      color: event.currentTarget.value,
                      opacity: appearance.scribble?.opacity ?? 0.9,
                    },
                  })
                }
                style={wideColorInputStyle}
              />
            </label>
            <NumberControl
              label="Opacity"
              value={appearance.scribble?.opacity ?? 0.9}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(next) =>
                update({
                  scribble: {
                    paths: appearance.scribble?.paths ?? [],
                    color: appearance.scribble?.color ?? "#F5B84D",
                    opacity: next,
                  },
                })
              }
            />
            <button
              type="button"
              className="lx-btn lx-btn-ghost"
              onClick={() => update({ scribble: null })}
            >
              Clear
            </button>
          </div>
        </EditorSection>
      </div>
    </div>
  );
}

function EditorSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section style={editorSectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={editorSectionTitleStyle}>{title}</span>
          {subtitle ? (
            <span
              className="lx-code"
              style={{
                color: "var(--lx-fg-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </section>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={editorFieldStyle}>
      <span style={editorLabelStyle}>{label}</span>
      <input
        className="lx-input lx-input-sm"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(clampEditorNumber(Number(event.currentTarget.value), min, max))}
        style={{ width: "100%" }}
      />
    </label>
  );
}

function clampEditorNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div style={editorMetricStyle}>
      <span style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</span>
      <strong className="lx-code" style={{ color: "var(--lx-fg-primary)", fontSize: 11 }}>
        {value}
      </strong>
    </div>
  );
}

const editorPreviewPanelStyle: CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto auto auto auto",
  alignContent: "start",
  gap: 12,
  minHeight: 0,
  padding: 12,
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-md)",
  background: "rgba(0,0,0,0.16)",
};

const editorInspectorStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  minHeight: 0,
  overflow: "auto",
  paddingRight: 4,
};

const editorSectionStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  minWidth: 0,
  padding: 12,
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-md)",
  background: "rgba(0,0,0,0.14)",
};

const editorSectionTitleStyle: CSSProperties = {
  color: "var(--lx-fg-primary)",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
};

const editorMetaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 7,
};

const editorMetricStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  padding: "7px 8px",
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-sm)",
  background: "rgba(255,255,255,0.025)",
};

const emptyEditorHintStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  minHeight: 70,
  border: "1px dashed var(--lx-stroke)",
  borderRadius: "var(--lx-radius-sm)",
  color: "var(--lx-fg-tertiary)",
  fontSize: 11,
};

const editorFieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const editorLabelStyle: CSSProperties = {
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const colorInputStyle: CSSProperties = {
  width: 34,
  height: 26,
  padding: 0,
  border: "1px solid var(--lx-stroke)",
  borderRadius: "var(--lx-radius-xs)",
  background: "transparent",
};

const wideColorInputStyle: CSSProperties = {
  ...colorInputStyle,
  width: "100%",
};

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
