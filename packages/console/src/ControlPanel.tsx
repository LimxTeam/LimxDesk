import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AttributeTabBar } from "./components/AttributeTabBar";
import { ToolButtonGroup } from "./components/ToolButtonGroup";
import { BigEncoderWheel } from "./components/BigEncoderWheel";
import { ModeButtonBar } from "./components/ModeButtonBar";
import { CommandButtonPanel } from "./components/CommandButtonPanel";
import { EncoderInfoBar } from "./components/EncoderInfoBar";

interface EncoderParam {
  name: string;
  value: string;
}

interface EncoderGroup {
  name: string;
  encoders: EncoderParam[];
}

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

interface FixtureTypeEntry {
  id: string;
  name: string;
  manufacturer: string;
  path: string;
  modes: FixtureTypeMode[];
}

interface FixtureTypeMode {
  id: string;
  name: string;
  channels: number;
  attributes: string[];
}

interface FixtureSelection {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

const ENCODERS_PER_PAGE = 4;

const FALLBACK_PAGE_INFO: Record<string, EncoderGroup> = {
  dimmer: {
    name: "Dimmer",
    encoders: [{ name: "Dim", value: "--" }],
  },
  position: {
    name: "Position",
    encoders: [
      { name: "Pan", value: "--" },
      { name: "Tilt", value: "--" },
    ],
  },
  gobo: {
    name: "Gobo",
    encoders: [{ name: "Gobo", value: "--" }],
  },
  color: {
    name: "Color",
    encoders: [{ name: "Color", value: "--" }],
  },
  beam: {
    name: "Beam",
    encoders: [{ name: "Beam", value: "--" }],
  },
  focus: {
    name: "Focus",
    encoders: [{ name: "Focus", value: "--" }],
  },
  selection: {
    name: "Selection",
    encoders: [{ name: "Fixture", value: "No Selection" }],
  },
  phaser: {
    name: "Phaser",
    encoders: [{ name: "Phase", value: "0°" }],
  },
  matricks: {
    name: "MAtricks",
    encoders: [{ name: "MAT", value: "" }],
  },
  progtime: {
    name: "ProgTime",
    encoders: [{ name: "Time", value: "3s" }],
  },
  exectime: {
    name: "ExecTime",
    encoders: [{ name: "Time", value: "3s" }],
  },
};

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState("dimmer");
  const [pageByTab, setPageByTab] = useState<Record<string, number>>({});
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState("");

  useEffect(() => {
    void refreshShowData();
    void refreshSelection();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const selectionChanged = await listen<FixtureSelection>(
        "fixture-selection:changed",
        (event) => {
          const primaryId = event.payload.primaryFixtureId ?? "";
          setSelectedFixtureId(primaryId);
          void refreshShowData(primaryId);
        },
      );
      const patchChanged = await listen("patch:changed", () => {
        void refreshShowData(selectedFixtureId);
      });
      const fixtureTypesChanged = await listen("fixture-types:changed", () => {
        void refreshShowData(selectedFixtureId);
      });
      const showLoaded = await listen("show:loaded", () => {
        void refreshShowData();
      });
      const showDeleted = await listen("show:deleted", () => {
        setFixtures([]);
        setFixtureTypes([]);
        setSelectedFixtureId("");
      });

      if (!active) {
        selectionChanged();
        patchChanged();
        fixtureTypesChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(selectionChanged, patchChanged, fixtureTypesChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [selectedFixtureId]);

  const selectedFixture =
    fixtures.find((fixture) => fixture.id === selectedFixtureId) ?? fixtures[0];
  const pageInfo = buildPageInfo(selectedFixture, fixtureTypes);
  const info = pageInfo[activeTab] ?? pageInfo.dimmer;
  const totalPages = Math.max(1, Math.ceil(info.encoders.length / ENCODERS_PER_PAGE));
  const currentPage = Math.min(pageByTab[activeTab] ?? 0, totalPages - 1);
  const pageLabel = `${currentPage + 1} of ${totalPages}`;
  const pageStart = currentPage * ENCODERS_PER_PAGE;
  const visibleEncoders = info.encoders.slice(pageStart, pageStart + ENCODERS_PER_PAGE);
  const canPaginate = totalPages > 1;

  async function refreshShowData(preferredFixtureId = selectedFixtureId) {
    try {
      const [document, types] = await Promise.all([
        invoke<PatchDocument | null>("patch_load_current_show"),
        invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show"),
      ]);
      const nextFixtures = document?.fixtures ?? [];
      setFixtures(nextFixtures);
      setFixtureTypes(types);
      setSelectedFixtureId((current) => {
        const preferred = preferredFixtureId || current;
        if (nextFixtures.some((fixture) => fixture.id === preferred)) return preferred;
        return nextFixtures[0]?.id ?? "";
      });
    } catch {
      setFixtures([]);
      setFixtureTypes([]);
      setSelectedFixtureId("");
    }
  }

  async function refreshSelection() {
    try {
      const selection = await invoke<FixtureSelection>("fixture_selection_get");
      setSelectedFixtureId(selection.primaryFixtureId ?? "");
    } catch {
      setSelectedFixtureId("");
    }
  }

  function handleAttributePageChange() {
    if (!canPaginate) return;

    setPageByTab((prev) => ({
      ...prev,
      [activeTab]: ((prev[activeTab] ?? 0) + 1) % totalPages,
    }));
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <AttributeTabBar activeId={activeTab} onChange={setActiveTab} />

      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <ToolButtonGroup />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "2px 8px",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 20,
              minHeight: 20,
              flexShrink: 0,
              marginBottom: 4,
            }}
          >
            <EncoderInfoBar
              attributeName={info.name}
              page={pageLabel}
              canPage={canPaginate}
              onAttributeClick={handleAttributePageChange}
            />
            <ModeButtonBar />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 20,
              flexShrink: 0,
              padding: "10px 16px 12px",
              boxSizing: "border-box",
            }}
          >
            {visibleEncoders.map((enc, i) => (
              <BigEncoderWheel
                key={`${info.name}-${enc.name}-${currentPage}-${i}`}
                paramName={enc.name}
                value={enc.value}
              />
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderLeft: "1px solid var(--lx-stroke)",
            flexShrink: 0,
          }}
        >
          <CommandButtonPanel
            onButtonPress={(label) => console.log("Button pressed:", label)}
          />
        </div>
      </div>
    </div>
  );
}

function buildPageInfo(
  fixture: PatchFixture | undefined,
  fixtureTypes: FixtureTypeEntry[],
): Record<string, EncoderGroup> {
  const groups = cloneFallbackPageInfo();
  if (!fixture) return groups;

  groups.selection = {
    name: "Selection",
    encoders: [
      { name: "FID", value: String(fixture.fid) },
      { name: "Fixture", value: fixture.name },
      { name: "Mode", value: fixture.modeName },
      { name: "Patch", value: formatPatch(fixture) },
    ],
  };

  const fixtureType = fixtureTypes.find((item) => item.path === fixture.fixtureTypePath);
  const mode = fixtureType?.modes.find((item) => item.id === fixture.modeId);
  if (!mode) return groups;

  const dynamicGroups = groupAttributes(mode.attributes);
  for (const [id, encoders] of Object.entries(dynamicGroups)) {
    if (encoders.length === 0) continue;
    groups[id] = {
      name: FALLBACK_PAGE_INFO[id]?.name ?? titleCase(id),
      encoders,
    };
  }

  return groups;
}

function groupAttributes(attributes: string[]) {
  const groups: Record<string, EncoderParam[]> = {
    dimmer: [],
    position: [],
    gobo: [],
    color: [],
    beam: [],
    focus: [],
  };

  for (const attribute of attributes) {
    const group = inferAttributeTab(attribute);
    groups[group].push({
      name: formatAttributeName(attribute),
      value: defaultAttributeValue(attribute),
    });
  }

  return groups;
}

function inferAttributeTab(attribute: string): keyof ReturnType<typeof groupAttributes> {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt") || lower.includes("position")) return "position";
  if (lower.includes("gobo")) return "gobo";
  if (lower.includes("color") || lower.includes("colour") || lower.includes("rgb") || lower.includes("cmy") || lower.includes("cto") || lower.includes("ctb")) return "color";
  if (lower.includes("focus")) return "focus";
  if (lower.includes("zoom") || lower.includes("iris") || lower.includes("prism") || lower.includes("frost") || lower.includes("beam")) return "beam";
  if (lower.includes("dim") || lower.includes("shutter") || lower.includes("strobe")) return "dimmer";
  return "beam";
}

function defaultAttributeValue(attribute: string) {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt") || lower.includes("rotate") || lower.includes("rot")) return "0°";
  if (lower.includes("gobo")) return "Open";
  if (lower.includes("dim")) return "100%";
  if (lower.includes("color") || lower.includes("rgb") || lower.includes("cmy")) return "0%";
  return "0%";
}

function formatAttributeName(attribute: string) {
  return attribute
    .replace(/^ColorAdd_/i, "")
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (match) => match.toUpperCase());
}

function cloneFallbackPageInfo() {
  return Object.fromEntries(
    Object.entries(FALLBACK_PAGE_INFO).map(([key, group]) => [
      key,
      {
        name: group.name,
        encoders: group.encoders.map((encoder) => ({ ...encoder })),
      },
    ]),
  ) as Record<string, EncoderGroup>;
}

function formatPatch(fixture: PatchFixture) {
  if (fixture.universe === null || fixture.address === null) return "-";
  return `${fixture.universe}.${String(fixture.address).padStart(3, "0")}`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
