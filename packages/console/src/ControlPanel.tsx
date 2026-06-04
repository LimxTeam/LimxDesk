import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AttributeTabBar } from "./components/AttributeTabBar";
import { ToolButtonGroup } from "./components/ToolButtonGroup";
import { BigEncoderWheel } from "./components/BigEncoderWheel";
import { ModeButtonBar } from "./components/ModeButtonBar";
import { CommandButtonPanel } from "./components/CommandButtonPanel";
import { EncoderInfoBar } from "./components/EncoderInfoBar";
import type { AttributeTab } from "./components/AttributeTabBar";

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
  attributeDetails?: FixtureModeAttribute[];
  subFixtures?: FixtureModeSubFixture[];
}

interface FixtureModeAttribute {
  name: string;
  featureGroup: string;
  occurrenceCount?: number;
  moduleIds?: string[];
}

interface FixtureModeSubFixture {
  id: string;
  name: string;
  geometry: string;
  index: number;
  firstAddress: number | null;
  channelCount: number;
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
type AttributeGroupId = "dimmer" | "position" | "gobo" | "color" | "beam" | "focus" | "control";
interface ProgrammerSetAttributeRequest {
  attribute: string;
  featureGroup: string;
  layer: ProgrammerLayer;
  value: ProgrammerScalar;
  source: ProgrammerValueSource;
}

const ENCODERS_PER_PAGE = 4;

const ATTRIBUTE_GROUP_LABELS: Record<AttributeGroupId, string> = {
  dimmer: "Dimmer",
  position: "Position",
  gobo: "Gobo",
  color: "Color",
  beam: "Beam",
  focus: "Focus",
  control: "Control",
};

const ATTRIBUTE_GROUP_ORDER: AttributeGroupId[] = ["dimmer", "position", "gobo", "color", "beam", "focus", "control"];

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
  const fixturesRef = useRef<PatchFixture[]>([]);

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
        if (!fixturesRef.current.some((fixture) => fixture.id === nextSelectedId)) {
          void refreshRuntimeData(event.payload);
        }
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
        fixturesRef.current = [];
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
    fixtures.find((fixture) => fixture.id === parentFixtureId(selection.primaryFixtureId ?? "")) ??
    fixtures.find((fixture) => fixture.id === parentFixtureId(selectedFixtureId));
  const pageInfo = buildPageInfo(selectedFixture, selection.primaryFixtureId ?? selectedFixtureId, fixtureTypes, programmer);
  const tabs = buildAttributeTabs(pageInfo);
  const info = pageInfo[activeTab] ?? pageInfo[tabs[0]?.id ?? ""] ?? {
    name: "No Attribute",
    encoders: [],
  };
  const totalPages = Math.max(1, Math.ceil(info.encoders.length / ENCODERS_PER_PAGE));
  const currentPage = Math.min(pageByTab[activeTab] ?? 0, totalPages - 1);
  const pageLabel = `${currentPage + 1} of ${totalPages}`;
  const pageStart = currentPage * ENCODERS_PER_PAGE;
  const visibleEncoders = info.encoders.slice(pageStart, pageStart + ENCODERS_PER_PAGE);
  const canPaginate = totalPages > 1;

  useEffect(() => {
    selectedFixtureIdRef.current = selectedFixtureId;
  }, [selectedFixtureId]);

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [activeTab, tabs]);

  async function refreshRuntimeData(selectionOverride?: FixtureSelection) {
    try {
      const types = await invoke<FixtureTypeEntry[]>("fixture_type_scan_current_show");
      const [document, currentSelection, currentProgrammer] = await Promise.all([
        invoke<PatchDocument | null>("patch_load_current_show"),
        invoke<FixtureSelection>("fixture_selection_get"),
        invoke<Programmer>("programmer_get"),
      ]);
      const nextFixtures = document?.fixtures ?? [];
      const nextSelection = selectionOverride ?? currentSelection;
      fixturesRef.current = nextFixtures;
      setFixtures(nextFixtures);
      setFixtureTypes(types);
      setSelection(nextSelection);
      setProgrammer(currentProgrammer);
      const nextSelectedId = resolveSelectedFixtureId(nextSelection, nextFixtures);
      selectedFixtureIdRef.current = nextSelectedId;
      setSelectedFixtureId(nextSelectedId);
    } catch {
      fixturesRef.current = [];
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
      <AttributeTabBar tabs={tabs} activeId={activeTab} onChange={setActiveTab} />

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
            {visibleEncoders.length > 0 ? (
              visibleEncoders.map((enc, i) => (
                <BigEncoderWheel
                  key={`${info.name}-${enc.name}-${currentPage}-${i}`}
                  paramName={enc.name}
                  value={enc.value}
                  onRotationChange={(rotation) => handleEncoderRotation(enc, rotation)}
                />
              ))
            ) : (
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 280,
                  height: 112,
                  color: "var(--lx-fg-tertiary)",
                  fontSize: 12,
                  border: "1px dashed var(--lx-stroke)",
                  borderRadius: "var(--lx-radius-sm)",
                  background: "rgba(0,0,0,0.18)",
                }}
              >
                {selectedFixture ? "当前灯具模式没有解析到 GDTF 属性" : "未选择灯具"}
              </div>
            )}
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
  selectedId: string,
  fixtureTypes: FixtureTypeEntry[],
  programmer: Programmer,
): Record<string, EncoderGroup> {
  const groups: Record<string, EncoderGroup> = {};
  if (!fixture) return groups;

  const fixtureType = fixtureTypes.find(
    (item) =>
      item.path === fixture.fixtureTypePath ||
      item.id === fixture.fixtureTypeId ||
      `${item.manufacturer} ${item.name}`.trim() === fixture.fixtureTypeName,
  );
  const mode =
    fixtureType?.modes.find((item) => item.id === fixture.modeId) ??
    fixtureType?.modes.find((item) => item.name === fixture.modeName) ??
    fixtureType?.modes.find((item) => item.channels === fixture.channels) ??
    fixtureType?.modes[0];
  if (!mode) return groups;

  const dynamicGroups = groupAttributes(resolveModeAttributes(mode, selectedSubFixtureId(selectedId)), fixture, selectedId, programmer);
  for (const [id, encoders] of Object.entries(dynamicGroups)) {
    if (encoders.length === 0) continue;
    groups[id] = {
      name: ATTRIBUTE_GROUP_LABELS[id as AttributeGroupId] ?? titleCase(id),
      encoders,
    };
  }

  return groups;
}

function groupAttributes(
  attributes: FixtureModeAttribute[],
  fixture: PatchFixture,
  selectedId: string,
  programmer: Programmer,
) {
  const groups: Record<AttributeGroupId, EncoderParam[]> = {
    dimmer: [],
    position: [],
    gobo: [],
    color: [],
    beam: [],
    focus: [],
    control: [],
  };

  for (const attribute of attributes) {
    const group = featureGroupToTab(attribute.featureGroup);
    groups[group].push({
      name: formatAttributeName(attribute.name),
      attribute: attribute.name,
      featureGroup: attribute.featureGroup,
      layer: "absolute",
      value: resolveProgrammerValue(programmer, selectedId || fixture.id, attribute.name) ?? "--",
    });
  }

  return groups;
}

function resolveModeAttributes(mode: FixtureTypeMode, subFixtureId: string): FixtureModeAttribute[] {
  const attributes = mode.attributeDetails?.length
    ? mode.attributeDetails.filter((attribute) => attribute.name.trim())
    : mode.attributes
        .filter((attribute) => attribute.trim())
        .map((attribute) => ({
          name: attribute,
          featureGroup: "Control",
        }));

  if (!subFixtureId) {
    return attributes;
  }

  const subFixture = mode.subFixtures?.find((item) => item.id === subFixtureId);
  if (!subFixture) {
    return attributes;
  }

  return attributes.filter((attribute) => subFixture.attributes.includes(attribute.name));
}

function featureGroupToTab(featureGroup: string): AttributeGroupId {
  const normalized = featureGroup.trim().toLowerCase();
  if (normalized === "dimmer" || normalized === "strobe") return "dimmer";
  if (normalized === "position") return "position";
  if (normalized === "gobo") return "gobo";
  if (normalized === "color" || normalized === "colour") return "color";
  if (normalized === "focus") return "focus";
  if (normalized === "beam") return "beam";
  return "control";
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

function resolveSelectedFixtureId(selection: FixtureSelection, fixtures: PatchFixture[]) {
  const preferred = selection.primaryFixtureId ?? selection.fixtureIds[0] ?? "";
  const parentId = parentFixtureId(preferred);
  if (preferred && fixtures.some((fixture) => fixture.id === parentId)) {
    return preferred;
  }
  return "";
}

function parentFixtureId(id: string) {
  return id.split("::sub:")[0] ?? id;
}

function selectedSubFixtureId(id: string) {
  return id.includes("::sub:") ? id.split("::sub:")[1] ?? "" : "";
}

function buildAttributeTabs(pageInfo: Record<string, EncoderGroup>): AttributeTab[] {
  const tabs: AttributeTab[] = [];
  for (const id of ATTRIBUTE_GROUP_ORDER) {
    if (pageInfo[id]?.encoders.length) {
      tabs.push({
        id,
        label: ATTRIBUTE_GROUP_LABELS[id],
        number: tabs.length + 1,
      });
    }
  }
  return tabs;
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

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
