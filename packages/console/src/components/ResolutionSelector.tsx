import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface ResolutionSelectorProps {
  label?: string;
  value?: string;
  options?: string[];
  onChange?: (value: string) => void;
}

export function ResolutionSelector({
  label = "Link Resolution",
  value: controlledValue,
  options = ["Single", "All", "Feature"],
  onChange,
}: ResolutionSelectorProps) {
  const [internalValue, setInternalValue] = useState("Single");
  const [open, setOpen] = useState(false);
  const value = controlledValue ?? internalValue;

  function handleSelect(v: string) {
    setInternalValue(v);
    setOpen(false);
    onChange?.(v);
  }

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          height: 22,
          borderRadius: "var(--lx-radius-xs)",
          border: "1px solid var(--lx-stroke)",
          background: "var(--lx-bg-deep)",
          cursor: "pointer",
          transition: "all var(--lx-duration-fast)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "var(--lx-fg-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--lx-fg-secondary)",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        <ChevronDown
          size={10}
          style={{
            color: "var(--lx-fg-muted)",
            transition: "transform var(--lx-duration-fast)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {open && (
        <>
          {/* 点击外部关闭 */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1,
            }}
            onClick={() => setOpen(false)}
          />
          {/* 下拉菜单 */}
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 2px)",
              left: 0,
              zIndex: 2,
              minWidth: "100%",
              background: "var(--lx-bg-elevated)",
              border: "1px solid var(--lx-stroke-strong)",
              borderRadius: "var(--lx-radius-sm)",
              boxShadow: "var(--lx-shadow-md)",
              overflow: "hidden",
            }}
          >
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "4px 10px",
                  fontSize: 10,
                  fontWeight: opt === value ? 600 : 400,
                  textAlign: "left",
                  border: "none",
                  background: opt === value ? "var(--lx-bg-hover)" : "transparent",
                  color:
                    opt === value
                      ? "var(--lx-fg-primary)"
                      : "var(--lx-fg-secondary)",
                  cursor: "pointer",
                  transition: "background var(--lx-duration-fast)",
                  whiteSpace: "nowrap",
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
