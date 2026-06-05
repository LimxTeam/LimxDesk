import { FixtureSheetWindow } from "./FixtureSheetWindow";
import { DmxSheetWindow } from "./DmxSheetWindow";
import { getWorkspaceWindowItem } from "./windowCatalog";
import type { WorkspaceWindow } from "./types";

export interface WindowSurfaceProps {
  window: WorkspaceWindow;
}

export function WindowSurface({ window }: WindowSurfaceProps) {
  const item = getWorkspaceWindowItem(window.type);

  if (window.type === "fixture-sheet") {
    return <FixtureSheetWindow />;
  }

  if (window.type === "dmx-sheet") {
    return <DmxSheetWindow />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 12,
        gap: 10,
        background:
          "linear-gradient(180deg, rgba(10, 12, 18, 0.94), rgba(18, 22, 30, 0.98))",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              color: item.accent,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {item.title}
          </span>
          <span
            style={{
              color: "var(--lx-fg-secondary)",
              fontSize: 11,
              lineHeight: 1.4,
              maxWidth: 300,
            }}
          >
            {item.blurb}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 6,
            minWidth: 132,
          }}
        >
          {item.metrics.map((metric) => (
            <div
              key={metric}
              style={{
                minHeight: 36,
                padding: "6px 8px",
                border: "1px solid var(--lx-stroke)",
                borderRadius: "var(--lx-radius-sm)",
                background: "rgba(255, 255, 255, 0.02)",
                color: "var(--lx-fg-tertiary)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {metric}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
          flex: 1,
          minHeight: 0,
        }}
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={`${window.id}-${index}`}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.05)",
              borderRadius: "var(--lx-radius-sm)",
              background:
                index % 3 === 0
                  ? "linear-gradient(180deg, rgba(77, 163, 245, 0.10), rgba(77, 163, 245, 0.02))"
                  : "linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01))",
              boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
