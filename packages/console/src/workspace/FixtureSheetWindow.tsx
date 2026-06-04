import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

interface PatchDocument {
  fixtures: PatchFixture[];
}

interface PatchFixture {
  id: string;
  fid: number;
  name: string;
  fixtureTypeId: string;
  fixtureTypeName: string;
  fixtureTypePath: string;
  modeId: string;
  modeName: string;
  channels: number;
  universe: number | null;
  address: number | null;
  stage: string;
  panInvert: boolean;
  tiltInvert: boolean;
}

export function FixtureSheetWindow() {
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Ready");

  const visibleFixtures = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return fixtures;
    return fixtures.filter((fixture) =>
      `${fixture.fid} ${fixture.name} ${fixture.fixtureTypeName} ${fixture.modeName} ${formatPatch(fixture)} ${fixture.stage}`
        .toLowerCase()
        .includes(needle),
    );
  }, [fixtures, query]);

  useEffect(() => {
    void loadPatch();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const patchChanged = await listen("patch:changed", () => {
        void loadPatch();
      });
      const showLoaded = await listen("show:loaded", () => {
        void loadPatch();
      });
      const showDeleted = await listen("show:deleted", () => {
        setFixtures([]);
        setSelectedId("");
        setStatus("No show loaded");
      });
      const selectionChanged = await listen<{ id: string }>(
        "fixture-selection:changed",
        (event) => {
          setSelectedId(event.payload.id);
        },
      );

      if (!active) {
        patchChanged();
        showLoaded();
        showDeleted();
        selectionChanged();
        return;
      }
      unlisteners.push(patchChanged, showLoaded, showDeleted, selectionChanged);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function loadPatch() {
    try {
      const document = await invoke<PatchDocument | null>("patch_load_current_show");
      const nextFixtures = document?.fixtures ?? [];
      setFixtures(nextFixtures);
      setSelectedId((current) =>
        nextFixtures.some((fixture) => fixture.id === current)
          ? current
          : nextFixtures[0]?.id ?? "",
      );
      setStatus(`${nextFixtures.length} fixture${nextFixtures.length === 1 ? "" : "s"}`);
    } catch {
      setFixtures([]);
      setSelectedId("");
      setStatus("No show loaded");
    }
  }

  function selectFixture(fixture: PatchFixture) {
    setSelectedId(fixture.id);
    void emit("fixture-selection:changed", {
      id: fixture.id,
      fid: fixture.fid,
      name: fixture.name,
      fixtureTypePath: fixture.fixtureTypePath,
      fixtureTypeId: fixture.fixtureTypeId,
      modeId: fixture.modeId,
    });
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
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search FID, name, type, patch..."
          style={{
            width: "100%",
            height: 24,
            border: "1px solid var(--lx-stroke)",
            borderRadius: "var(--lx-radius-xs)",
            background: "rgba(0,0,0,0.28)",
            color: "var(--lx-fg-primary)",
            fontSize: 11,
            outline: "none",
            padding: "0 8px",
          }}
        />
        <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", whiteSpace: "nowrap" }}>
          {visibleFixtures.length}/{fixtures.length}
        </span>
      </div>

      <div style={{ minHeight: 0, overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            minWidth: 760,
            borderCollapse: "collapse",
            fontSize: 11,
            color: "var(--lx-fg-secondary)",
          }}
        >
          <thead>
            <tr
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                height: 26,
                background: "var(--lx-bg-deep)",
                color: "var(--lx-fg-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <HeaderCell width={64}>FID</HeaderCell>
              <HeaderCell>Name</HeaderCell>
              <HeaderCell width={180}>Fixture Type</HeaderCell>
              <HeaderCell width={120}>Mode</HeaderCell>
              <HeaderCell width={88}>Patch</HeaderCell>
              <HeaderCell width={72}>Ch</HeaderCell>
              <HeaderCell width={94}>Stage</HeaderCell>
              <HeaderCell width={98}>State</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {visibleFixtures.map((fixture) => {
              const selected = fixture.id === selectedId;
              return (
                <tr
                  key={fixture.id}
                  onClick={() => selectFixture(fixture)}
                  style={{
                    height: 28,
                    background: selected ? "rgba(77, 163, 245, 0.18)" : "transparent",
                    color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
                    cursor: "pointer",
                  }}
                >
                  <BodyCell mono>{fixture.fid}</BodyCell>
                  <BodyCell strong>{fixture.name}</BodyCell>
                  <BodyCell>{fixture.fixtureTypeName}</BodyCell>
                  <BodyCell>{fixture.modeName}</BodyCell>
                  <BodyCell mono>{formatPatch(fixture)}</BodyCell>
                  <BodyCell mono>{fixture.channels}</BodyCell>
                  <BodyCell>{fixture.stage}</BodyCell>
                  <BodyCell>
                    <StateBadge fixture={fixture} />
                  </BodyCell>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibleFixtures.length === 0 && (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 120,
              color: "var(--lx-fg-tertiary)",
              fontSize: 11,
            }}
          >
            No fixtures
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
        <span>{selectedId ? "Selection linked to encoders" : "No selection"}</span>
      </div>
    </div>
  );
}

function HeaderCell({ children, width }: { children: React.ReactNode; width?: number }) {
  return (
    <th
      style={{
        width,
        borderBottom: "1px solid var(--lx-stroke)",
        padding: "0 8px",
        textAlign: "left",
        fontWeight: 800,
      }}
    >
      {children}
    </th>
  );
}

function BodyCell({
  children,
  mono = false,
  strong = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={mono ? "lx-code" : undefined}
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.045)",
        padding: "0 8px",
        fontWeight: strong ? 750 : undefined,
        color: strong ? "var(--lx-fg-primary)" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function StateBadge({ fixture }: { fixture: PatchFixture }) {
  const patched = fixture.universe !== null && fixture.address !== null;
  const overflow = patched && fixture.address !== null && fixture.address + fixture.channels - 1 > 512;
  const label = overflow ? "Overflow" : patched ? "Patched" : "Open";
  const color = overflow
    ? "var(--lx-status-error)"
    : patched
      ? "var(--lx-action-bright)"
      : "var(--lx-accent-bright)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 18,
        border: `1px solid ${color}`,
        borderRadius: "var(--lx-radius-xs)",
        color,
        padding: "0 6px",
        fontSize: 10,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function formatPatch(fixture: PatchFixture) {
  if (fixture.universe === null || fixture.address === null) return "-";
  return `${fixture.universe}.${String(fixture.address).padStart(3, "0")}`;
}
