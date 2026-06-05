import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface DmxUniverseFrame {
  universe: number;
  data: number[];
}

const CHANNELS_PER_ROW = 16;

export function DmxSheetWindow() {
  const [frames, setFrames] = useState<DmxUniverseFrame[]>([]);
  const [selectedUniverse, setSelectedUniverse] = useState<number | null>(null);
  const [status, setStatus] = useState("Ready");

  const frame = useMemo(() => {
    if (frames.length === 0) return null;
    return frames.find((item) => item.universe === selectedUniverse) ?? frames[0];
  }, [frames, selectedUniverse]);

  const activeChannels = useMemo(
    () => frame?.data.filter((value) => value > 0).length ?? 0,
    [frame],
  );

  useEffect(() => {
    void loadFrames();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const events = await Promise.all([
        listen("output:sent", () => void loadFrames()),
        listen("programmer:changed", () => void loadFrames()),
        listen("patch:changed", () => void loadFrames()),
        listen("fixture-types:changed", () => void loadFrames()),
        listen("show:loaded", () => void loadFrames()),
        listen("show:deleted", () => {
          setFrames([]);
          setSelectedUniverse(null);
          setStatus("No show loaded");
        }),
      ]);

      if (!active) {
        events.forEach((unlisten) => unlisten());
        return;
      }
      unlisteners.push(...events);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function loadFrames() {
    try {
      const nextFrames = await invoke<DmxUniverseFrame[]>("output_render_dmx");
      nextFrames.sort((left, right) => left.universe - right.universe);
      setFrames(nextFrames);
      setSelectedUniverse((current) => {
        if (current !== null && nextFrames.some((item) => item.universe === current)) {
          return current;
        }
        return nextFrames[0]?.universe ?? null;
      });
      setStatus(`${nextFrames.length} universe${nextFrames.length === 1 ? "" : "s"}`);
    } catch {
      setFrames([]);
      setSelectedUniverse(null);
      setStatus("No show loaded");
    }
  }

  return (
    <div
      style={{
        display: "grid",
        height: "100%",
        minHeight: 0,
        gridTemplateRows: "34px minmax(0, 1fr) 24px",
        background: "var(--lx-bg-abyss)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px",
          borderBottom: "1px solid var(--lx-stroke)",
          background: "rgba(255,255,255,0.025)",
        }}
      >
        <span
          style={{
            color: "var(--lx-fg-secondary)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Universe
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflowX: "auto" }}>
          {frames.map((item) => {
            const selected = item.universe === frame?.universe;
            return (
              <button
                key={item.universe}
                type="button"
                onClick={() => setSelectedUniverse(item.universe)}
                style={{
                  height: 22,
                  minWidth: 42,
                  border: selected ? "1px solid var(--lx-primary-trace)" : "1px solid var(--lx-stroke)",
                  borderRadius: "var(--lx-radius-xs)",
                  background: selected ? "rgba(77,163,245,0.20)" : "rgba(0,0,0,0.24)",
                  color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {item.universe}
              </button>
            );
          })}
        </div>
        <span className="lx-code" style={{ marginLeft: "auto", color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
          {frame ? `${activeChannels}/512 active` : "0/512 active"}
        </span>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: 8 }}>
        {frame ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${CHANNELS_PER_ROW}, minmax(44px, 1fr))`,
              gap: 2,
              minWidth: 760,
            }}
          >
            {frame.data.slice(0, 512).map((value, index) => {
              const active = value > 0;
              return (
                <div
                  key={index}
                  style={{
                    height: 38,
                    border: active ? "1px solid rgba(120,217,120,0.52)" : "1px solid rgba(255,255,255,0.055)",
                    background: active ? "rgba(120,217,120,0.13)" : "rgba(255,255,255,0.025)",
                    color: active ? "var(--lx-fg-primary)" : "var(--lx-fg-tertiary)",
                    display: "grid",
                    gridTemplateRows: "13px 1fr",
                    alignItems: "center",
                    padding: "2px 5px",
                    boxSizing: "border-box",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span className="lx-code" style={{ fontSize: 9, opacity: 0.78 }}>
                    {index + 1}
                  </span>
                  <span className="lx-code" style={{ fontSize: 16, fontWeight: 850, lineHeight: 1 }}>
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 160,
              color: "var(--lx-fg-tertiary)",
              fontSize: 12,
              border: "1px dashed var(--lx-stroke)",
              borderRadius: "var(--lx-radius-sm)",
              background: "rgba(0,0,0,0.18)",
            }}
          >
            No rendered DMX frame
          </div>
        )}
      </div>

      <div
        className="lx-code"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          borderTop: "1px solid var(--lx-stroke)",
          color: "var(--lx-fg-tertiary)",
          fontSize: 10,
        }}
      >
        <span>{status}</span>
        <span>{frame ? `Universe ${frame.universe}` : "No universe"}</span>
      </div>
    </div>
  );
}
