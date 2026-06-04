import { useEffect, useRef, useState } from "react";
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
  attribute?: string;
  featureGroup?: string;
  layer?: ProgrammerLayer;
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

interface Programmer {
  live: ProgrammerBuffer;
  preview: ProgrammerBuffer;
  mode: ProgrammerMode;
  blind: boolean;
  version: number;
}

interface ProgrammerBuffer {
  selectedPartId: number;
  parts: ProgrammerPart[];
}

interface ProgrammerPart {
  id: number;
  label: string | null;
  values: ProgrammerValue[];
}

interface ProgrammerValue {
  fixtureId: string;
  attribute: string;
  featureGroup: string;
  layer: ProgrammerLayer;
  value: ProgrammerScalar;
  active: boolean;
  source: ProgrammerValueSource;
}

interface ProgrammerScalar {
  numeric: number | null;
  text: string | null;
}

type ProgrammerMode = "live" | "preview";
type ProgrammerLayer = "absolute" | "relative" | "fade" | "delay";
type ProgrammerValueSource = "manual" | "preset" | "output";
interface ProgrammerSetAttributeRequest {
  attribute: string;
  featureGroup: string;
  layer: ProgrammerLayer;
  value: ProgrammerScalar;
  source: ProgrammerValueSource;
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
  const [selection, setSelection] = useState<FixtureSelection>({
    fixtureIds: [],
    primaryFixtureId: null,
    version: 0,
  });
  const [programmer, setProgrammer] = useState<Programmer>({
    live: { selectedPartId: 0, parts: [] },
    preview: { selectedPartId: 0, parts: [] },
    mode: "live",
    blind: false,
    version: 0,
  });
  const selectedFixtureIdRef = useRef("");

  useEffect(() => {
    void refreshRuntimeData();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const selectionChanged = await listen<FixtureSelection>("fixture-selection:changed", (event) => {
        setSelection(event.payload);
        const nextSelectedId = event.payload.primaryFixtureId ?? "";
        selectedFixtureIdRef.current = nextSelectedId;
        setSelectedFixtureId(nextSelectedId);
      });
      const programmerChanged = await listen<Programmer>("programmer:changed", (event) => {
        setProgrammer(event.payload);
      });
      const patchChanged = await listen("patch:changed", () => {
        void refreshRuntimeData();
      });
      const fixtureTypesChanged = await listen("fixture-types:changed", () => {
        void refreshRuntimeData();
      });
      const showLoaded = await listen("show:loaded", () => {
        void refreshRuntimeData();
      });
      const showDeleted = await listen("show:deleted", () => {
        setFixtures([]);
        setFixtureTypes([]);
        selectedFixtureIdRef.current = "";
        setSelectedFixtureId("");
        setSelection({
          fixtureIds: [],
          primaryFixtureId: null,
          version: 0,
        });
        setProgrammer({
          live: { selectedPartId: 0, parts: [] },
          preview: { selectedPartId: 0, parts: [] },
          mode: "live",
          blind: false,
          version: 0,
        });
      });

      if (!active) {
        selectionChanged();
        programmerChanged();
        patchChanged();
        fixtureTypesChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(selectionChanged, programmerChanged, patchChanged, fixtureTypesChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const selectedFixture =
    fixtures.find((fixture) => fixture.id === selection.primaryFixtureId) ??
    fixtures.find((fixture) => fixture.id === selectedFixtureId);
  const pageInfo = buildPageInfo(selectedFixture, fixtureTypes, programmer);
  const info = pageInfo[activeTab] ?? pageInfo.dimmer;
  const totalPages = Math.max(1, Math.ceil(info.encoders.length / ENCODERS_PER_PAGE));
  const currentPage = Math.min(pageByTab[activeTab] ?? 0, totalPages - 1);
  const pageLabel = `${currentPage + 1} of ${totalPages}`;
  const pageStart = currentPage * ENCODERS_PER_PAGE;
  const visibleEncoders = info.encoders.slice(pageStart, pageStart + ENCODERS_PER_PAGE);
  const canPaginate = totalPages > 1;

  useEffect(() => {
    selectedFixtureIdRef.current = selectedFixtureId;
  }, [selectedFixtureId]);

  async function refreshRuntimeData() {
    try {
      const [document, types, currentSelection, currentProgrammer] = await Promise.all([
        invoke<PatchDocument | null>("patch_load_current_show"),
        invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show"),
        invoke<FixtureSelection>("fixture_selection_get"),
        invoke<Programmer>("programmer_get"),
      ]);
      const nextFixtures = document?.fixtures ?? [];
      setFixtures(nextFixtures);
      setFixtureTypes(types);
      setSelection(currentSelection);
      setProgrammer(currentProgrammer);
      const nextSelectedId = resolveSelectedFixtureId(currentSelection, nextFixtures);
      selectedFixtureIdRef.current = nextSelectedId;
      setSelectedFixtureId(nextSelectedId);
    } catch {
      setFixtures([]);
      setFixtureTypes([]);
      selectedFixtureIdRef.current = "";
      setSelectedFixtureId("");
      setSelection({
        fixtureIds: [],
        primaryFixtureId: null,
        version: 0,
      });
      setProgrammer({
        live: { selectedPartId: 0, parts: [] },
        preview: { selectedPartId: 0, parts: [] },
        mode: "live",
        blind: false,
        version: 0,
      });
    }
  }

  function handleAttributePageChange() {
    if (!canPaginate) return;

    setPageByTab((prev) => ({
      ...prev,
      [activeTab]: ((prev[activeTab] ?? 0) + 1) % totalPages,
    }));
  }

  function handleEncoderRotation(encoder: EncoderParam, rotation: number) {
    if (!selectedFixtureIdRef.current || !encoder.attribute || !encoder.featureGroup || !encoder.layer) return;
    const value = deriveProgrammerValue(encoder.attribute, rotation);
    void invoke<Programmer>("programmer_set_attribute_for_selection", {
      request: {
        attribute: encoder.attribute,
        featureGroup: encoder.featureGroup,
        layer: encoder.layer,
        value,
        source: "manual",
      } satisfies ProgrammerSetAttributeRequest,
      }).catch((error) => {
      console.error("Failed to update programmer", error);
    });
  }

  function handleCommandButton(label: string) {
    if (label !== "Clear") return;
    void invoke("programmer_clear", { target: "contextual" })
      .then(() => refreshRuntimeData())
      .catch((error) => {
        console.error("Failed to clear programmer", error);
      });
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
                onRotationChange={(rotation) => handleEncoderRotation(enc, rotation)}
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
          <CommandButtonPanel onButtonPress={handleCommandButton} />
        </div>
      </div>
    </div>
  );
}

function buildPageInfo(
  fixture: PatchFixture | undefined,
  fixtureTypes: FixtureTypeEntry[],
  programmer: Programmer,
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

  const dynamicGroups = groupAttributes(mode.attributes, fixture, programmer);
  for (const [id, encoders] of Object.entries(dynamicGroups)) {
    if (encoders.length === 0) continue;
    groups[id] = {
      name: FALLBACK_PAGE_INFO[id]?.name ?? titleCase(id),
      encoders,
    };
  }

  return groups;
}

function groupAttributes(attributes: string[], fixture: PatchFixture, programmer: Programmer) {
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
      attribute,
      featureGroup: titleCase(group),
      layer: "absolute",
      value: resolveProgrammerValue(programmer, fixture.id, attribute) ?? defaultAttributeValue(attribute),
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

function resolveProgrammerValue(programmer: Programmer, fixtureId: string, attribute: string) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  const values = buffer.parts.flatMap((part) => part.values);
  const match = values.find(
    (value) => value.fixtureId === fixtureId && value.attribute === attribute && value.active,
  );
  if (!match) return null;
  return formatProgrammerScalar(match.value, attribute);
}

function formatProgrammerScalar(value: ProgrammerScalar, attribute: string) {
  if (value.text && value.text.trim()) return value.text;
  if (typeof value.numeric === "number" && Number.isFinite(value.numeric)) {
    const lower = attribute.toLowerCase();
    if (lower.includes("pan") || lower.includes("tilt") || lower.includes("rotate") || lower.includes("rot")) {
      return `${value.numeric.toFixed(1)}°`;
    }
    if (lower.includes("gobo")) {
      return value.numeric.toFixed(0);
    }
    return `${value.numeric.toFixed(0)}%`;
  }
  return "--";
}

function cloneFallbackPageInfo() {
  return Object.fromEntries(
    Object.entries(FALLBACK_PAGE_INFO).map(([key, group]) => [
      key,
      {
        name: group.name,
        encoders: group.encoders.map((encoder) => ({
          ...encoder,
          attribute: "",
          featureGroup: group.name,
          layer: "absolute" as ProgrammerLayer,
        })),
      },
    ]),
  ) as Record<string, EncoderGroup>;
}

function resolveSelectedFixtureId(selection: FixtureSelection, fixtures: PatchFixture[]) {
  const preferred = selection.primaryFixtureId ?? selection.fixtureIds[0] ?? "";
  if (preferred && fixtures.some((fixture) => fixture.id === preferred)) {
    return preferred;
  }
  return "";
}

function deriveProgrammerValue(attribute: string, rotation: number): ProgrammerScalar {
  const lower = attribute.toLowerCase();
  if (lower.includes("pan") || lower.includes("tilt") || lower.includes("rotate") || lower.includes("rot")) {
    const value = rotation - 180;
    return {
      numeric: value,
      text: `${value.toFixed(1)}°`,
    };
  }

  const percent = Math.max(0, Math.min(100, Math.round((rotation / 360) * 100)));
  return {
    numeric: percent,
    text: `${percent}%`,
  };
}

function formatPatch(fixture: PatchFixture) {
  if (fixture.universe === null || fixture.address === null) return "-";
  return `${fixture.universe}.${String(fixture.address).padStart(3, "0")}`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
