import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AttributeTabBar } from "./components/AttributeTabBar";
import { ToolButtonGroup } from "./components/ToolButtonGroup";
import { BigEncoderWheel } from "./components/BigEncoderWheel";
import { ModeButtonBar } from "./components/ModeButtonBar";
import { CommandButtonPanel } from "./components/CommandButtonPanel";
import { EncoderInfoBar } from "./components/EncoderInfoBar";
import {
  activateCommandMode,
  appendCommandToken,
  cancelCommandStep,
  clearCommandEntry,
  executeCurrentCommand,
  pushCommandHistory,
  redoLastCommand,
  setCommandTarget,
  undoLastCommand,
  type DeskCommandMode,
  type DeskCommandTarget,
} from "./command/commandRuntime";
import { restoreFixtureSelection } from "./command/selectionHistory";
import type { AttributeTab } from "./components/AttributeTabBar";

interface EncoderParam {
  name: string;
  value: string;
  active: boolean;
  attribute?: string;
  featureGroup?: string;
  layer?: ProgrammerLayer;
  valueKind?: FixtureAttributeValueKind;
  minValue?: number | null;
  maxValue?: number | null;
  defaultValue?: number | null;
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
  minValue?: number | null;
  maxValue?: number | null;
  defaultValue?: number | null;
  valueKind?: FixtureAttributeValueKind;
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

interface ProgrammerClearResult {
  programmer: Programmer;
}

interface ProgrammerScalar {
  numeric: number | null;
  text: string | null;
}

type ProgrammerMode = "live" | "preview";
type ProgrammerLayer = "absolute" | "relative" | "fade" | "delay";
type ProgrammerValueSource = "manual" | "preset" | "output";
type AttributeGroupId = "dimmer" | "position" | "gobo" | "color" | "beam" | "focus" | "control";
type FixtureAttributeValueKind = "percent" | "angle" | "range" | string;
interface ProgrammerAdjustAttributeRequest {
  attribute: string;
  featureGroup: string;
  layer: ProgrammerLayer;
  delta: number;
  valueKind: string;
  minValue: number | null;
  maxValue: number | null;
  defaultValue: number | null;
  source: ProgrammerValueSource;
}

interface PendingProgrammerAdjustment {
  request: ProgrammerAdjustAttributeRequest;
  selection: FixtureSelection;
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
  const programmerRef = useRef(programmer);
  const pendingEncoderAdjustments = useRef<Map<string, PendingProgrammerAdjustment>>(new Map());
  const inFlightEncoderAdjustments = useRef<Set<string>>(new Set());
  const encoderWriteGeneration = useRef(0);

  useEffect(() => {
    void refreshRuntimeData();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const selectionChanged = await listen<FixtureSelection>("fixture-selection:changed", (event) => {
        clearEncoderWriteState();
        setSelection(event.payload);
        const nextSelectedId = event.payload.primaryFixtureId ?? "";
        selectedFixtureIdRef.current = nextSelectedId;
        setSelectedFixtureId(nextSelectedId);
        if (!fixturesRef.current.some((fixture) => fixture.id === parentFixtureId(nextSelectedId))) {
          void refreshRuntimeData(event.payload);
        }
      });
      const programmerChanged = await listen<Programmer>("programmer:changed", (event) => {
        programmerRef.current = event.payload;
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
        clearEncoderWriteState();
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
    programmerRef.current = programmer;
  }, [programmer]);

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
      programmerRef.current = currentProgrammer;
      clearEncoderWriteState();
      const nextSelectedId = resolveSelectedFixtureId(nextSelection, nextFixtures);
      selectedFixtureIdRef.current = nextSelectedId;
      setSelectedFixtureId(nextSelectedId);
    } catch {
      fixturesRef.current = [];
      setFixtures([]);
      setFixtureTypes([]);
      selectedFixtureIdRef.current = "";
      clearEncoderWriteState();
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

  function handleEncoderDelta(encoder: EncoderParam, delta: number) {
    if (!selectedFixtureIdRef.current || !encoder.attribute || !encoder.featureGroup || !encoder.layer) return;
    const key = encoderWriteKey(selectedFixtureIdRef.current, encoder);
    const request = {
      attribute: encoder.attribute,
      featureGroup: encoder.featureGroup,
      layer: encoder.layer,
      delta,
      valueKind: encoder.valueKind ?? "percent",
      minValue: encoder.minValue ?? null,
      maxValue: encoder.maxValue ?? null,
      defaultValue: encoder.defaultValue ?? null,
      source: "manual",
    } satisfies ProgrammerAdjustAttributeRequest;

    queueProgrammerAdjustment(key, { request, selection });
  }

  function queueProgrammerAdjustment(key: string, adjustment: PendingProgrammerAdjustment) {
    const pending = pendingEncoderAdjustments.current.get(key);
    if (pending) {
      pending.request.delta += adjustment.request.delta;
    } else {
      pendingEncoderAdjustments.current.set(key, adjustment);
    }
    if (inFlightEncoderAdjustments.current.has(key)) return;
    void flushProgrammerAdjustment(key);
  }

  async function flushProgrammerAdjustment(key: string) {
    const adjustment = pendingEncoderAdjustments.current.get(key);
    if (!adjustment) return;

    const generation = encoderWriteGeneration.current;
    pendingEncoderAdjustments.current.delete(key);
    inFlightEncoderAdjustments.current.add(key);

    try {
      const nextProgrammer = await invoke<Programmer>("programmer_adjust_attribute_for_selection", {
        request: adjustment.request,
        selection: adjustment.selection,
      });
      if (generation === encoderWriteGeneration.current) {
        programmerRef.current = nextProgrammer;
        setProgrammer(nextProgrammer);
      }
    } catch (error) {
      console.error("Failed to update programmer", error);
    } finally {
      inFlightEncoderAdjustments.current.delete(key);
      if (pendingEncoderAdjustments.current.has(key)) {
        void flushProgrammerAdjustment(key);
      }
    }
  }

  function clearEncoderWriteState() {
    encoderWriteGeneration.current += 1;
    pendingEncoderAdjustments.current.clear();
  }

  function handleCommandButton(label: string) {
    if (label === "Undo") {
      void undoLastCommand();
      return;
    }

    if (label === "Redo") {
      void redoLastCommand();
      return;
    }

    if (label === "ESC") {
      cancelCommandStep();
      return;
    }

    if (label === "Clear") {
      clearEncoderWriteState();
      clearCommandEntry("Clear programmer");
      void clearProgrammerWithHistory();
      return;
    }

    const mode = commandModeForButton(label);
    if (mode) {
      activateCommandMode(mode);
      return;
    }

    const target = commandTargetForButton(label);
    if (target) {
      setCommandTarget(target);
      return;
    }

    if (label === "Please") {
      void executeCurrentCommand();
      return;
    }

    appendCommandToken(label);
  }

  async function clearProgrammerWithHistory() {
    try {
      const [beforeProgrammer, beforeSelection] = await Promise.all([
        invoke<Programmer>("programmer_get"),
        invoke<FixtureSelection>("fixture_selection_get"),
      ]);
      const result = await invoke<ProgrammerClearResult>("programmer_clear", { target: "contextual" });
      const afterSelection = await invoke<FixtureSelection>("fixture_selection_get");
      pushCommandHistory({
        label: "Clear programmer",
        undo: async () => {
          await invoke("programmer_replace_current", { programmer: beforeProgrammer });
          await restoreFixtureSelection(beforeSelection);
        },
        redo: async () => {
          await invoke("programmer_replace_current", { programmer: result.programmer });
          await restoreFixtureSelection(afterSelection);
        },
      });
      await refreshRuntimeData(afterSelection);
    } catch (error) {
      console.error("Failed to clear programmer", error);
    }
  }

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableEventTarget(event.target)) return;

      const button = commandButtonForKeyboardEvent(event);
      if (!button) return;
      event.preventDefault();
      handleCommandButton(button);
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

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
              active={info.encoders.some((encoder) => encoder.active)}
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
                  active={enc.active}
                  onRotationDelta={(delta) => handleEncoderDelta(enc, delta)}
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
      active: isProgrammerAttributeActive(programmer, selectedId || fixture.id, attribute.name),
      value:
        resolveProgrammerValue(programmer, selectedId || fixture.id, attribute) ??
        formatDefaultAttributeValue(attribute),
      valueKind: attribute.valueKind,
      minValue: attribute.minValue,
      maxValue: attribute.maxValue,
      defaultValue: normalizeDefaultForProgrammer(attribute),
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
          valueKind: "range",
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

function resolveProgrammerValue(programmer: Programmer, fixtureId: string, attribute: FixtureModeAttribute) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  const values = buffer.parts.flatMap((part) => part.values);
  const match = values.find(
    (value) => value.fixtureId === fixtureId && value.attribute === attribute.name && value.active,
  );
  if (!match) return null;
  return formatProgrammerScalar(match.value, attribute);
}

function commandModeForButton(label: string): DeskCommandMode | null {
  if (label === "Store") return "store";
  if (label === "Update") return "update";
  if (label === "Edit") return "edit";
  if (label === "Delete") return "delete";
  if (label === "Copy") return "copy";
  if (label === "Move") return "move";
  if (label === "Assign") return "assign";
  if (label === "Select") return "select";
  if (label === "On") return "on";
  if (label === "Off") return "off";
  if (label === "Stomp") return "stomp";
  return null;
}

function commandTargetForButton(label: string): DeskCommandTarget | null {
  if (label === "Fixture") return "fixture";
  if (label === "Group") return "group";
  if (label === "Preset") return "preset";
  if (label === "Sequence") return "sequence";
  if (label === "Cue") return "cue";
  if (label === "DESK") return "executor";
  return null;
}

function commandButtonForKeyboardEvent(event: KeyboardEvent) {
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (event.code.startsWith("Numpad") && /^[0-9]$/.test(event.code.replace("Numpad", ""))) {
    return event.code.replace("Numpad", "");
  }
  if (event.key === "Enter" || event.code === "NumpadEnter") return "Please";
  if (event.key === "Escape") return "ESC";
  if (event.key === "Backspace") return "ESC";
  if (event.key === "Delete") return "Delete";
  if (event.key === "+") return "+";
  if (event.key === "-") return "-";
  if (event.key === ".") return ".";
  if (event.key === "/") return "/";
  if (event.code === "NumpadAdd") return "+";
  if (event.code === "NumpadSubtract") return "-";
  if (event.code === "NumpadDecimal") return ".";
  if (event.code === "NumpadDivide") return "/";

  const key = event.key.toLowerCase();
  if (key === "z") return "Undo";
  if (key === "y") return "Redo";
  if (key === "t") return "Thru";
  if (key === "a") return "At";
  if (key === "x") return "Assign";
  if (key === "i") return "If";
  if (key === "s") return "Store";
  if (key === "u") return "Update";
  if (key === "e") return "Edit";
  if (key === "c") return "Clear";
  if (key === "v") return "Copy";
  if (key === "m") return "Move";
  if (key === "l") return "Select";
  if (key === "f") return "Fixture";
  if (key === "g") return "Group";
  if (key === "p") return "Preset";
  if (key === "q") return "Sequence";
  if (key === "b") return "Cue";
  if (key === "d") return "DESK";
  if (key === "o") return "On";
  if (key === "n") return "Off";
  return null;
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function isProgrammerAttributeActive(programmer: Programmer, fixtureId: string, attribute: string) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  return buffer.parts.some((part) =>
    part.values.some((value) => value.fixtureId === fixtureId && value.attribute === attribute && value.active),
  );
}

function formatDefaultAttributeValue(attribute: FixtureModeAttribute) {
  const value = normalizeDefaultForProgrammer(attribute);
  if (value === null) return "--";
  return formatProgrammerScalar({ numeric: value, text: null }, attribute);
}

function normalizeDefaultForProgrammer(attribute: FixtureModeAttribute) {
  const value = attribute.defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (attribute.valueKind === "percent") {
    const max = attribute.maxValue;
    if (typeof max === "number" && Number.isFinite(max) && max <= 1.0) {
      return value * 100;
    }
  }
  return value;
}

function encoderWriteKey(fixtureId: string, encoder: EncoderParam) {
  return `${fixtureId}:${encoder.attribute ?? ""}:${encoder.layer ?? "absolute"}`;
}

function formatProgrammerScalar(value: ProgrammerScalar, attribute: FixtureModeAttribute | string) {
  if (value.text && value.text.trim()) return value.text;
  if (typeof value.numeric === "number" && Number.isFinite(value.numeric)) {
    const detail: FixtureModeAttribute =
      typeof attribute === "string" ? { name: attribute, featureGroup: "Control" } : attribute;
    const lower = detail.name.toLowerCase();
    if (detail.valueKind === "angle" || lower.includes("pan") || lower.includes("tilt") || lower.includes("rotate") || lower.includes("rot")) {
      return `${value.numeric.toFixed(1)}°`;
    }
    if (detail.valueKind === "range" || lower.includes("gobo")) {
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
        highlight: pageInfo[id].encoders.some((encoder) => encoder.active) ? "amber" : null,
      });
    }
  }
  return tabs;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
