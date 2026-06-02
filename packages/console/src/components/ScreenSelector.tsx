import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";

interface ScreenItem {
  id: string;
  label: string;
  subLabel: string;
}

const DEFAULT_SCREENS: ScreenItem[] = [
  { id: "screen-y", label: "Screen Y", subLabel: "Display 1" },
  { id: "screen-x", label: "Screen X", subLabel: "Display 1" },
];

interface ScreenSelectorProps {
  screens?: ScreenItem[];
}

export function ScreenSelector({ screens = DEFAULT_SCREENS }: ScreenSelectorProps) {
  const [page, setPage] = useState(1);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {/* 屏幕列表 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        {screens.map((screen) => (
          <div
            key={screen.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* 小圆点指示器 */}
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "1px solid var(--lx-stroke-strong)",
                background: "var(--lx-bg-deep)",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: "var(--lx-fg-tertiary)",
                whiteSpace: "nowrap",
              }}
            >
              {screen.label} / {screen.subLabel}
            </span>
          </div>
        ))}
      </div>

      {/* 导航控制 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          style={{
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--lx-radius-xs)",
            border: "1px solid var(--lx-stroke)",
            background: "var(--lx-bg-deep)",
            color: "var(--lx-fg-tertiary)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ChevronLeft size={10} />
        </button>

        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "var(--lx-font-mono)",
            color: "var(--lx-fg-secondary)",
            minWidth: 16,
            textAlign: "center",
          }}
        >
          {page}
        </span>

        <button
          onClick={() => setPage((p) => p + 1)}
          style={{
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--lx-radius-xs)",
            border: "1px solid var(--lx-stroke)",
            background: "var(--lx-bg-deep)",
            color: "var(--lx-fg-tertiary)",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ChevronRight size={10} />
        </button>

        <button
          onClick={() => setPage(1)}
          style={{
            width: 18,
            height: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--lx-radius-xs)",
            border: "1px solid var(--lx-stroke)",
            background: "var(--lx-bg-deep)",
            color: "var(--lx-fg-tertiary)",
            cursor: "pointer",
            padding: 0,
            marginLeft: 2,
          }}
        >
          <RotateCcw size={8} />
        </button>
      </div>
    </div>
  );
}
