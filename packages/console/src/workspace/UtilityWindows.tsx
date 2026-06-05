import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createDefaultNamedAppearance, normalizeNamedAppearance, type NamedAppearance } from "@limxdesk/naming";
import { FloatingDialog, NamedAppearanceEditor, NamedAppearanceTile } from "@limxdesk/ui";
import {
  clearWorkspaceRuntimeCache,
  loadCachedFixtureTypes,
  loadCachedPatch,
  loadCachedProgrammer,
  loadCachedSelection,
  setWorkspaceRuntimeValue,
} from "./workspaceRuntime";

interface WindowToolProps {
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
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
}

interface FixtureModeAttribute {
  name: string;
  featureGroup: string;
  minValue?: number | null;
  maxValue?: number | null;
  defaultValue?: number | null;
  valueKind?: string;
}

interface FixtureSelection {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

interface Programmer {
  live: ProgrammerBuffer;
  preview: ProgrammerBuffer;
  mode: "live" | "preview";
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
  layer: "absolute" | "relative" | "fade" | "delay";
  value: {
    numeric: number | null;
    text: string | null;
  };
  active: boolean;
  source: "manual" | "preset" | "output";
}

interface GroupSlot {
  id: number;
  appearance: NamedAppearance;
  fixtureIds: string[];
  primaryFixtureId: string | null;
}

interface PresetSlot {
  id: number;
  appearance: NamedAppearance;
  values: ProgrammerValue[];
  category: PresetCategoryId;
}

type PresetCategoryId = "all" | "dimmer" | "position" | "gobo" | "color" | "beam" | "focus" | "shapers" | "control";
type ColorChannelId = "R" | "G" | "B" | "W" | "C" | "M" | "Y" | "A" | "L";
type ShaperControlId = "top" | "bottom" | "left" | "right" | "iris" | "rotate" | "soft";

const GROUP_SLOT_COUNT = 255;
const PRESET_SLOT_COUNT = 120;
const COLOR_CHANNELS: ColorChannelId[] = ["R", "G", "B", "W", "C", "M", "Y", "A", "L"];
const PRESET_CATEGORIES: Array<{ id: PresetCategoryId; label: string }> = [
  { id: "all", label: "All" },
  { id: "dimmer", label: "Dimmer" },
  { id: "position", label: "Position" },
  { id: "gobo", label: "Gobo" },
  { id: "color", label: "Color" },
  { id: "beam", label: "Beam" },
  { id: "focus", label: "Focus" },
  { id: "shapers", label: "Shapers" },
  { id: "control", label: "Control" },
];

const COLOR_SWATCHES = [
  { label: "Open", values: { R: 100, G: 100, B: 100, W: 100, C: 0, M: 0, Y: 0, A: 0, L: 0 } },
  { label: "Red", values: { R: 100, G: 0, B: 0, W: 0, C: 0, M: 100, Y: 100, A: 10, L: 0 } },
  { label: "Green", values: { R: 0, G: 100, B: 0, W: 0, C: 100, M: 0, Y: 100, A: 0, L: 45 } },
  { label: "Blue", values: { R: 0, G: 0, B: 100, W: 0, C: 100, M: 100, Y: 0, A: 0, L: 0 } },
  { label: "Amber", values: { R: 100, G: 42, B: 0, W: 0, C: 0, M: 24, Y: 100, A: 100, L: 8 } },
  { label: "Cyan", values: { R: 0, G: 100, B: 100, W: 0, C: 100, M: 0, Y: 0, A: 0, L: 16 } },
  { label: "Magenta", values: { R: 100, G: 0, B: 100, W: 0, C: 0, M: 100, Y: 0, A: 0, L: 0 } },
  { label: "Warm", values: { R: 100, G: 72, B: 35, W: 40, C: 0, M: 15, Y: 70, A: 70, L: 12 } },
];

const COLOR_ALIASES: Record<ColorChannelId, string[]> = {
  R: ["r", "red", "coloradd_r", "rgb_r"],
  G: ["g", "green", "coloradd_g", "rgb_g"],
  B: ["b", "blue", "coloradd_b", "rgb_b"],
  W: ["w", "white", "coloradd_w", "rgb_w"],
  C: ["cyan", "coloradd_c", "cmy_c"],
  M: ["magenta", "coloradd_m", "cmy_m"],
  Y: ["yellow", "coloradd_y", "cmy_y"],
  A: ["amber", "coloradd_a"],
  L: ["lime", "coloradd_l"],
};

const SHAPER_ALIASES: Record<ShaperControlId, string[]> = {
  top: ["blade1a", "blade 1a", "shaper1a", "top"],
  bottom: ["blade1b", "blade 1b", "shaper1b", "bottom"],
  left: ["blade2a", "blade 2a", "shaper2a", "left"],
  right: ["blade2b", "blade 2b", "shaper2b", "right"],
  iris: ["iris"],
  rotate: ["shaperrotate", "shaper rot", "blade rotate", "rotation"],
  soft: ["soft", "frost", "edge"],
};

export function GroupsWindow({ config, onConfigChange }: WindowToolProps) {
  const [selection, setSelection] = useState<FixtureSelection>({ fixtureIds: [], primaryFixtureId: null, version: 0 });
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [editor, setEditor] = useState<GroupSlot | null>(null);
  const slots = useMemo(() => normalizeGroupSlots(config.groups), [config.groups]);

  useEffect(() => {
    void loadSelection();
    let active = true;
    let unlisten: (() => void) | null = null;
    void listen<FixtureSelection>("fixture-selection:changed", (event) => {
      setWorkspaceRuntimeValue("selection", event.payload);
      setSelection(event.payload);
    }).then((next) => {
      if (active) unlisten = next;
      else next();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  async function loadSelection() {
    try {
      setSelection(await loadCachedSelection<FixtureSelection>());
    } catch {
      setSelection({ fixtureIds: [], primaryFixtureId: null, version: 0 });
    }
  }

  function updateSlots(nextSlots: GroupSlot[]) {
    onConfigChange({ ...config, groups: nextSlots });
  }

  function storeSlot(id: number) {
    if (selection.fixtureIds.length === 0) return;
    const existing = slots.find((slot) => slot.id === id);
    const nextSlot: GroupSlot = {
      id,
      appearance: normalizeNamedAppearance(existing?.appearance, `Group ${id}`),
      fixtureIds: selection.fixtureIds,
      primaryFixtureId: selection.primaryFixtureId,
    };
    updateSlots(upsertSlot(slots, nextSlot));
    setActiveSlotId(id);
  }

  function clearSlot(id: number) {
    updateSlots(slots.filter((slot) => slot.id !== id));
    if (activeSlotId === id) setActiveSlotId(null);
  }

  async function recallSlot(slot: GroupSlot) {
    if (slot.fixtureIds.length === 0) return;
    setActiveSlotId(slot.id);
    await invoke("fixture_selection_select", {
      fixtureIds: slot.fixtureIds,
      primaryFixtureId: slot.primaryFixtureId ?? slot.fixtureIds[0] ?? null,
      mode: "replace",
    });
  }

  return (
    <ToolWindowShell
      title="Groups"
      subtitle={`${slots.length}/${GROUP_SLOT_COUNT} stored`}
      right={<span className="lx-code">{selection.fixtureIds.length} selected</span>}
    >
      <div style={poolGridStyle}>
        {Array.from({ length: GROUP_SLOT_COUNT }, (_, index) => {
          const id = index + 1;
          const slot = slots.find((item) => item.id === id);
          return (
            <PoolTileButton
              key={id}
              title={slot ? `Recall Group ${id}` : `Store Group ${id}`}
              onClick={() => (slot ? void recallSlot(slot) : storeSlot(id))}
              onContextMenu={(event) => {
                event.preventDefault();
                setEditor(slot ?? createEmptyGroupSlot(id));
              }}
            >
              <NamedAppearanceTile
                appearance={slot?.appearance ?? createDefaultNamedAppearance(`Group ${id}`)}
                fallbackLabel={String(id)}
                empty={!slot}
                active={activeSlotId === id}
                height={46}
                compact
              />
              <PoolMeta>{slot ? `${slot.fixtureIds.length} fixtures` : String(id)}</PoolMeta>
            </PoolTileButton>
          );
        })}
      </div>
      <SlotEditorDialog
        title="Edit Group"
        open={Boolean(editor)}
        value={editor?.appearance}
        onClose={() => setEditor(null)}
        onApply={(appearance) => {
          if (!editor) return;
          updateSlots(upsertSlot(slots, { ...editor, appearance }));
          setEditor(null);
        }}
        onClear={() => {
          if (!editor) return;
          clearSlot(editor.id);
          setEditor(null);
        }}
      />
    </ToolWindowShell>
  );
}

export function ColorPickerWindow({ config, onConfigChange }: WindowToolProps) {
  const { selection, attributes, fixtureLabel } = useSelectedFixtureAttributes();
  const [values, setValues] = useState<Record<ColorChannelId, number>>(() => normalizeColorValues(config.colorValues));
  const supported = useMemo(() => mapColorAttributes(attributes), [attributes]);

  function updateValues(nextValues: Record<ColorChannelId, number>) {
    setValues(nextValues);
    onConfigChange({ ...config, colorValues: nextValues });
  }

  async function setChannel(channel: ColorChannelId, value: number) {
    const nextValues = { ...values, [channel]: value };
    updateValues(nextValues);
    const attribute = supported[channel];
    if (!attribute || selection.fixtureIds.length === 0) return;
    await setProgrammerAttribute(attribute, value, "manual");
  }

  async function applySwatch(swatch: (typeof COLOR_SWATCHES)[number]) {
    updateValues(swatch.values);
    await Promise.all(
      COLOR_CHANNELS.map((channel) => {
        const attribute = supported[channel];
        return attribute ? setProgrammerAttribute(attribute, swatch.values[channel], "manual") : Promise.resolve();
      }),
    );
  }

  return (
    <ToolWindowShell
      title="Color Picker"
      subtitle={fixtureLabel}
      right={<span className="lx-code">{Object.values(supported).filter(Boolean).length}/9 attrs</span>}
    >
      <div style={{ display: "grid", gridTemplateRows: "112px minmax(0, 1fr)", gap: 8, minHeight: 0 }}>
        <div style={colorPreviewStyle(values)}>
          <strong>{fixtureLabel}</strong>
          <span className="lx-code">{selection.fixtureIds.length} selected</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 8, minHeight: 0 }}>
          <div style={colorChannelPanelStyle}>
            {COLOR_CHANNELS.map((channel) => (
              <label key={channel} style={channelRowStyle(!supported[channel])}>
                <span>{channel}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={values[channel]}
                  disabled={!supported[channel]}
                  onChange={(event) => void setChannel(channel, Number(event.currentTarget.value))}
                />
                <output className="lx-code">{Math.round(values[channel])}</output>
              </label>
            ))}
          </div>
          <div style={swatchGridStyle}>
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch.label}
                type="button"
                onClick={() => void applySwatch(swatch)}
                style={{
                  ...swatchButtonStyle,
                  background: colorCss(swatch.values),
                }}
              >
                <span>{swatch.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ToolWindowShell>
  );
}

export function PresetsWindow({ config, onConfigChange }: WindowToolProps) {
  const [category, setCategory] = useState<PresetCategoryId>("all");
  const [storeMode, setStoreMode] = useState(false);
  const [editor, setEditor] = useState<PresetSlot | null>(null);
  const slots = useMemo(() => normalizePresetSlots(config.presets), [config.presets]);
  const categorySlots = slots.filter((slot) => slot.category === category);

  function updateSlots(nextSlots: PresetSlot[]) {
    onConfigChange({ ...config, presets: nextSlots });
  }

  async function storeSlot(id: number) {
    const programmer = await loadCachedProgrammer<Programmer>();
    const values = activeProgrammerValues(programmer).filter((value) => presetValueMatchesCategory(value, category));
    if (values.length === 0) return;
    const existing = slots.find((slot) => slot.id === id && slot.category === category);
    const slot: PresetSlot = {
      id,
      category,
      values,
      appearance: normalizeNamedAppearance(existing?.appearance, `${presetCategoryLabel(category)} ${id}`),
    };
    updateSlots(upsertPresetSlot(slots, slot));
    setStoreMode(false);
  }

  async function recallSlot(slot: PresetSlot) {
    await Promise.all(
      slot.values
        .filter((value) => value.active)
        .map((value) => setProgrammerAttribute(value, value.value.numeric ?? 0, "preset")),
    );
  }

  function clearSlot(slot: PresetSlot) {
    updateSlots(slots.filter((item) => !(item.category === slot.category && item.id === slot.id)));
  }

  return (
    <ToolWindowShell
      title="Preset Pool"
      subtitle={`${categorySlots.length} stored in ${presetCategoryLabel(category)}`}
      right={<ToggleButton active={storeMode} onClick={() => setStoreMode((value) => !value)}>Store</ToggleButton>}
    >
      <div style={{ display: "grid", gridTemplateRows: "28px minmax(0, 1fr)", gap: 8, minHeight: 0 }}>
        <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
          {PRESET_CATEGORIES.map((item) => (
            <ToggleButton key={item.id} active={category === item.id} onClick={() => setCategory(item.id)}>
              {item.label}
            </ToggleButton>
          ))}
        </div>
        <div style={poolGridStyle}>
          {Array.from({ length: PRESET_SLOT_COUNT }, (_, index) => {
            const id = index + 1;
            const slot = slots.find((item) => item.category === category && item.id === id);
            return (
              <PoolTileButton
                key={`${category}-${id}`}
                title={slot ? `Recall Preset ${id}` : `Store Preset ${id}`}
                onClick={() => (storeMode || !slot ? void storeSlot(id) : void recallSlot(slot))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setEditor(slot ?? createEmptyPresetSlot(id, category));
                }}
              >
                <NamedAppearanceTile
                  appearance={slot?.appearance ?? createDefaultNamedAppearance(`${presetCategoryLabel(category)} ${id}`)}
                  fallbackLabel={String(id)}
                  empty={!slot}
                  height={48}
                  compact
                />
                <PoolMeta>{slot ? `${slot.values.length} values` : String(id)}</PoolMeta>
              </PoolTileButton>
            );
          })}
        </div>
      </div>
      <SlotEditorDialog
        title="Edit Preset"
        open={Boolean(editor)}
        value={editor?.appearance}
        onClose={() => setEditor(null)}
        onApply={(appearance) => {
          if (!editor) return;
          updateSlots(upsertPresetSlot(slots, { ...editor, appearance }));
          setEditor(null);
        }}
        onClear={() => {
          if (!editor) return;
          clearSlot(editor);
          setEditor(null);
        }}
      />
    </ToolWindowShell>
  );
}

export function ShapersWindow({ config, onConfigChange }: WindowToolProps) {
  const { selection, attributes, fixtureLabel } = useSelectedFixtureAttributes();
  const [dragging, setDragging] = useState<ShaperControlId | null>(null);
  const [values, setValues] = useState<Record<ShaperControlId, number>>(() => normalizeShaperValues(config.shapers));
  const supported = useMemo(() => mapShaperAttributes(attributes), [attributes]);
  const padRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => updateBladeFromPointer(dragging, event.clientX, event.clientY);
    const up = () => setDragging(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, values, supported]);

  function updateValues(nextValues: Record<ShaperControlId, number>) {
    setValues(nextValues);
    onConfigChange({ ...config, shapers: nextValues });
  }

  async function setControl(control: ShaperControlId, value: number) {
    const nextValues = { ...values, [control]: value };
    updateValues(nextValues);
    const attribute = supported[control];
    if (!attribute || selection.fixtureIds.length === 0) return;
    await setProgrammerAttribute(attribute, value, "manual");
  }

  function updateBladeFromPointer(control: ShaperControlId, clientX: number, clientY: number) {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    const y = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
    if (control === "top") void setControl(control, y);
    if (control === "bottom") void setControl(control, 100 - y);
    if (control === "left") void setControl(control, x);
    if (control === "right") void setControl(control, 100 - x);
  }

  return (
    <ToolWindowShell
      title="Shapers"
      subtitle={fixtureLabel}
      right={<span className="lx-code">{Object.values(supported).filter(Boolean).length}/7 attrs</span>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 160px", gap: 10, minHeight: 0 }}>
        <div
          ref={padRef}
          style={{
            position: "relative",
            overflow: "hidden",
            border: "1px solid rgba(101,212,199,0.28)",
            background: "radial-gradient(circle, rgba(255,255,255,0.08), transparent 50%), #030405",
          }}
        >
          <div style={shaperBeamStyle} />
          <BladeHandle side="top" value={values.top} disabled={!supported.top} onPointerDown={() => setDragging("top")} />
          <BladeHandle side="bottom" value={values.bottom} disabled={!supported.bottom} onPointerDown={() => setDragging("bottom")} />
          <BladeHandle side="left" value={values.left} disabled={!supported.left} onPointerDown={() => setDragging("left")} />
          <BladeHandle side="right" value={values.right} disabled={!supported.right} onPointerDown={() => setDragging("right")} />
          <div style={{ position: "absolute", inset: 12, border: "1px dashed rgba(255,255,255,0.18)", pointerEvents: "none" }} />
        </div>
        <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
          {(["top", "bottom", "left", "right", "iris", "rotate", "soft"] as ShaperControlId[]).map((control) => (
            <label key={control} style={channelRowStyle(!supported[control])}>
              <span>{control}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={values[control]}
                disabled={!supported[control]}
                onChange={(event) => void setControl(control, Number(event.currentTarget.value))}
              />
              <output className="lx-code">{Math.round(values[control])}</output>
            </label>
          ))}
        </div>
      </div>
    </ToolWindowShell>
  );
}

function useSelectedFixtureAttributes() {
  const [selection, setSelection] = useState<FixtureSelection>({ fixtureIds: [], primaryFixtureId: null, version: 0 });
  const [fixtures, setFixtures] = useState<PatchFixture[]>([]);
  const [fixtureTypes, setFixtureTypes] = useState<FixtureTypeEntry[]>([]);

  useEffect(() => {
    void refresh();
    let active = true;
    const unlisteners: Array<() => void> = [];
    const register = async () => {
      const selectionChanged = await listen<FixtureSelection>("fixture-selection:changed", (event) => {
        setWorkspaceRuntimeValue("selection", event.payload);
        setSelection(event.payload);
      });
      const patchChanged = await listen("patch:changed", () => {
        clearWorkspaceRuntimeCache(["patch"]);
        void loadPatch();
      });
      const fixtureTypesChanged = await listen("fixture-types:changed", () => {
        clearWorkspaceRuntimeCache(["fixtureTypes"]);
        void loadFixtureTypes();
      });
      if (!active) {
        selectionChanged();
        patchChanged();
        fixtureTypesChanged();
        return;
      }
      unlisteners.push(selectionChanged, patchChanged, fixtureTypesChanged);
    };
    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };

    async function refresh() {
      await Promise.all([loadSelection(), loadPatch(), loadFixtureTypes()]);
    }
    async function loadSelection() {
      try {
        setSelection(await loadCachedSelection<FixtureSelection>());
      } catch {
        setSelection({ fixtureIds: [], primaryFixtureId: null, version: 0 });
      }
    }
    async function loadPatch() {
      try {
        const document = await loadCachedPatch<PatchDocument | null>();
        setFixtures(document?.fixtures ?? []);
      } catch {
        setFixtures([]);
      }
    }
    async function loadFixtureTypes() {
      try {
        setFixtureTypes(await loadCachedFixtureTypes<FixtureTypeEntry[]>());
      } catch {
        setFixtureTypes([]);
      }
    }
  }, []);

  const primaryId = selection.primaryFixtureId ?? selection.fixtureIds[0] ?? "";
  const fixture = fixtures.find((item) => item.id === parentFixtureId(primaryId)) ?? fixtures[0] ?? null;
  const mode = fixture ? findModeForFixture(fixture, fixtureTypes) : null;
  return {
    selection,
    fixture,
    attributes: mode?.attributeDetails ?? [],
    fixtureLabel: fixture ? `${fixture.fid} ${fixture.name}` : "No fixture selected",
  };
}

function SlotEditorDialog({
  title,
  open,
  value,
  onClose,
  onApply,
  onClear,
}: {
  title: string;
  open: boolean;
  value: NamedAppearance | undefined;
  onClose: () => void;
  onApply: (value: NamedAppearance) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(() => normalizeNamedAppearance(value));

  useEffect(() => {
    setDraft(normalizeNamedAppearance(value));
  }, [value]);

  return (
    <FloatingDialog open={open} title={title} subtitle="Naming appearance" width={900} height={620} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) 36px", gap: 10, height: "100%" }}>
        <NamedAppearanceEditor value={draft} onChange={setDraft} title="NAMING" />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button type="button" onClick={onClear} style={dangerButtonStyle}>Clear Slot</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={plainButtonStyle}>Cancel</button>
            <button type="button" onClick={() => onApply(draft)} style={primaryButtonStyle}>Apply</button>
          </div>
        </div>
      </div>
    </FloatingDialog>
  );
}

async function setProgrammerAttribute(
  attribute: Pick<ProgrammerValue, "attribute" | "featureGroup"> | FixtureModeAttribute,
  value: number,
  source: "manual" | "preset",
) {
  await invoke("programmer_set_attribute_for_selection", {
    request: {
      attribute: "attribute" in attribute ? attribute.attribute : attribute.name,
      featureGroup: attribute.featureGroup,
      layer: "absolute",
      value: { numeric: value, text: null },
      source,
    },
  });
}

function activeProgrammerValues(programmer: Programmer) {
  const buffer = programmer.mode === "preview" ? programmer.preview : programmer.live;
  return buffer.parts.flatMap((part) => part.values).filter((value) => value.active);
}

function presetValueMatchesCategory(value: ProgrammerValue, category: PresetCategoryId) {
  if (category === "all") return true;
  const group = value.featureGroup.toLowerCase();
  const attr = value.attribute.toLowerCase();
  if (category === "shapers") return group.includes("shaper") || attr.includes("blade") || attr.includes("shaper");
  return group.includes(category) || attr.includes(category);
}

function normalizeGroupSlots(value: unknown): GroupSlot[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map<GroupSlot | null>((item) => {
      const record = asRecord(item);
      const id = clampInt(record.id, 1, GROUP_SLOT_COUNT);
      const fixtureIds = Array.isArray(record.fixtureIds) ? record.fixtureIds.filter((id): id is string => typeof id === "string") : [];
      if (fixtureIds.length === 0) return null;
      return {
        id,
        fixtureIds,
        primaryFixtureId: typeof record.primaryFixtureId === "string" ? record.primaryFixtureId : fixtureIds[0] ?? null,
        appearance: normalizeNamedAppearance(record.appearance as Partial<NamedAppearance>, `Group ${id}`),
      };
    })
    .filter((item): item is GroupSlot => Boolean(item));
}

function normalizePresetSlots(value: unknown): PresetSlot[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item) => {
      const record = asRecord(item);
      const id = clampInt(record.id, 1, PRESET_SLOT_COUNT);
      const category = isPresetCategory(record.category) ? record.category : "all";
      const values = Array.isArray(record.values) ? (record.values as ProgrammerValue[]).filter((value) => value.active) : [];
      if (values.length === 0) return null;
      return {
        id,
        category,
        values,
        appearance: normalizeNamedAppearance(record.appearance as Partial<NamedAppearance>, `${presetCategoryLabel(category)} ${id}`),
      };
    })
    .filter((item): item is PresetSlot => Boolean(item));
}

function normalizeColorValues(value: unknown): Record<ColorChannelId, number> {
  const record = asRecord(value);
  return Object.fromEntries(COLOR_CHANNELS.map((channel) => [channel, clampNumber(record[channel], 0, 100)])) as Record<ColorChannelId, number>;
}

function normalizeShaperValues(value: unknown): Record<ShaperControlId, number> {
  const record = asRecord(value);
  return {
    top: clampNumber(record.top, 0, 100),
    bottom: clampNumber(record.bottom, 0, 100),
    left: clampNumber(record.left, 0, 100),
    right: clampNumber(record.right, 0, 100),
    iris: clampNumber(record.iris, 0, 100),
    rotate: clampNumber(record.rotate, 0, 100),
    soft: clampNumber(record.soft, 0, 100),
  };
}

function mapColorAttributes(attributes: FixtureModeAttribute[]) {
  return Object.fromEntries(
    COLOR_CHANNELS.map((channel) => [channel, findAttributeByAliases(attributes, COLOR_ALIASES[channel])]),
  ) as Record<ColorChannelId, FixtureModeAttribute | null>;
}

function mapShaperAttributes(attributes: FixtureModeAttribute[]) {
  return Object.fromEntries(
    (Object.keys(SHAPER_ALIASES) as ShaperControlId[]).map((control) => [
      control,
      findAttributeByAliases(attributes, SHAPER_ALIASES[control]),
    ]),
  ) as Record<ShaperControlId, FixtureModeAttribute | null>;
}

function findAttributeByAliases(attributes: FixtureModeAttribute[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeAttributeName);
  return (
    attributes.find((attribute) => normalizedAliases.includes(normalizeAttributeName(attribute.name))) ??
    attributes.find((attribute) => normalizedAliases.some((alias) => normalizeAttributeName(attribute.name).includes(alias))) ??
    null
  );
}

function normalizeAttributeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function upsertSlot<T extends { id: number }>(slots: T[], slot: T) {
  return [...slots.filter((item) => item.id !== slot.id), slot].sort((left, right) => left.id - right.id);
}

function upsertPresetSlot(slots: PresetSlot[], slot: PresetSlot) {
  return [
    ...slots.filter((item) => !(item.id === slot.id && item.category === slot.category)),
    slot,
  ].sort((left, right) => left.category.localeCompare(right.category) || left.id - right.id);
}

function createEmptyGroupSlot(id: number): GroupSlot {
  return {
    id,
    appearance: createDefaultNamedAppearance(`Group ${id}`),
    fixtureIds: [],
    primaryFixtureId: null,
  };
}

function createEmptyPresetSlot(id: number, category: PresetCategoryId): PresetSlot {
  return {
    id,
    category,
    appearance: createDefaultNamedAppearance(`${presetCategoryLabel(category)} ${id}`),
    values: [],
  };
}

function findModeForFixture(fixture: PatchFixture, fixtureTypes: FixtureTypeEntry[]) {
  const fixtureType = fixtureTypes.find(
    (item) =>
      item.path === fixture.fixtureTypePath ||
      item.id === fixture.fixtureTypeId ||
      `${item.manufacturer} ${item.name}`.trim() === fixture.fixtureTypeName,
  );
  return (
    fixtureType?.modes.find((mode) => mode.id === fixture.modeId) ??
    fixtureType?.modes.find((mode) => mode.name === fixture.modeName) ??
    fixtureType?.modes.find((mode) => mode.channels === fixture.channels) ??
    fixtureType?.modes[0] ??
    null
  );
}

function parentFixtureId(id: string) {
  return id.split("::sub:")[0] ?? id;
}

function presetCategoryLabel(category: PresetCategoryId) {
  return PRESET_CATEGORIES.find((item) => item.id === category)?.label ?? "Preset";
}

function isPresetCategory(value: unknown): value is PresetCategoryId {
  return PRESET_CATEGORIES.some((item) => item.id === value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clampNumber(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  return clamp(Number.isFinite(number) ? number : min, min, max);
}

function clampInt(value: unknown, min: number, max: number) {
  return Math.round(clampNumber(value, min, max));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorCss(values: Record<ColorChannelId, number>) {
  const r = clamp(Math.round((values.R + values.A * 0.75 + values.W * 0.35) * 2.55), 0, 255);
  const g = clamp(Math.round((values.G + values.L * 0.85 + values.W * 0.35 + values.A * 0.28) * 2.55), 0, 255);
  const b = clamp(Math.round((values.B + values.W * 0.35) * 2.55), 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function ToolWindowShell({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateRows: "32px minmax(0, 1fr)", height: "100%", minHeight: 0, background: "var(--lx-bg-void)" }}>
      <div style={toolHeaderStyle}>
        <div style={{ display: "grid", gap: 1, minWidth: 0 }}>
          <strong style={{ color: "var(--lx-fg-primary)", fontSize: 12 }}>{title}</strong>
          <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subtitle}
          </span>
        </div>
        {right}
      </div>
      <div style={{ minHeight: 0, overflow: "hidden", padding: 8 }}>{children}</div>
    </div>
  );
}

function PoolTileButton({
  title,
  children,
  onClick,
  onContextMenu,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" title={title} onClick={onClick} onContextMenu={onContextMenu} style={poolTileButtonStyle}>
      {children}
    </button>
  );
}

function PoolMeta({ children }: { children: React.ReactNode }) {
  return <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{children}</span>;
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{ ...toggleButtonStyle, ...(active ? toggleButtonActiveStyle : null) }}>
      {children}
    </button>
  );
}

function BladeHandle({
  side,
  value,
  disabled,
  onPointerDown,
}: {
  side: "top" | "bottom" | "left" | "right";
  value: number;
  disabled: boolean;
  onPointerDown: () => void;
}) {
  const common: React.CSSProperties = {
    position: "absolute",
    background: disabled ? "rgba(255,255,255,0.16)" : "rgba(101,212,199,0.82)",
    border: "1px solid rgba(255,255,255,0.45)",
    cursor: disabled ? "not-allowed" : side === "left" || side === "right" ? "ew-resize" : "ns-resize",
  };
  const style: React.CSSProperties =
    side === "top"
      ? { ...common, left: "12%", right: "12%", top: `${value}%`, height: 5 }
      : side === "bottom"
        ? { ...common, left: "12%", right: "12%", bottom: `${value}%`, height: 5 }
        : side === "left"
          ? { ...common, top: "12%", bottom: "12%", left: `${value}%`, width: 5 }
          : { ...common, top: "12%", bottom: "12%", right: `${value}%`, width: 5 };
  return <div style={style} onPointerDown={() => !disabled && onPointerDown()} />;
}

const toolHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "0 8px",
  borderBottom: "1px solid var(--lx-stroke)",
  background: "rgba(255,255,255,0.025)",
};

const poolGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
  alignContent: "start",
  gap: 6,
  height: "100%",
  minHeight: 0,
  overflow: "auto",
  paddingRight: 2,
};

const poolTileButtonStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto 14px",
  gap: 2,
  minWidth: 0,
  border: 0,
  background: "transparent",
  padding: 0,
  color: "inherit",
  cursor: "pointer",
};

const colorChannelPanelStyle: React.CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: 5,
  minHeight: 0,
  overflow: "auto",
};

function channelRowStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) 32px",
    alignItems: "center",
    gap: 6,
    height: 24,
    opacity: disabled ? 0.38 : 1,
    color: "var(--lx-fg-secondary)",
    fontSize: 10,
    fontWeight: 800,
  };
}

function colorPreviewStyle(values: Record<ColorChannelId, number>): React.CSSProperties {
  return {
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 5,
    border: "1px solid rgba(255,255,255,0.08)",
    background: `linear-gradient(135deg, ${colorCss(values)}, rgba(0,0,0,0.78))`,
    color: "#fff",
    textShadow: "0 1px 6px rgba(0,0,0,0.95)",
  };
}

const swatchGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  alignContent: "start",
  gap: 6,
  overflow: "auto",
};

const swatchButtonStyle: React.CSSProperties = {
  minHeight: 42,
  border: "1px solid rgba(255,255,255,0.16)",
  color: "#fff",
  fontSize: 10,
  fontWeight: 900,
  textShadow: "0 1px 5px rgba(0,0,0,0.95)",
  cursor: "pointer",
};

const shaperBeamStyle: React.CSSProperties = {
  position: "absolute",
  inset: "18%",
  borderRadius: "50%",
  background: "radial-gradient(circle, rgba(255,255,255,0.86), rgba(255,255,255,0.18) 48%, transparent 72%)",
  filter: "blur(0.2px)",
  pointerEvents: "none",
};

const toggleButtonStyle: React.CSSProperties = {
  height: 24,
  flex: "0 0 auto",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.24)",
  color: "var(--lx-fg-secondary)",
  padding: "0 8px",
  fontSize: 10,
  fontWeight: 850,
  cursor: "pointer",
};

const toggleButtonActiveStyle: React.CSSProperties = {
  border: "1px solid rgba(240,157,28,0.62)",
  color: "var(--lx-accent-bright)",
  background: "rgba(240,157,28,0.12)",
};

const plainButtonStyle: React.CSSProperties = {
  height: 28,
  border: "1px solid var(--lx-stroke)",
  background: "rgba(0,0,0,0.22)",
  color: "var(--lx-fg-secondary)",
  padding: "0 12px",
};

const primaryButtonStyle: React.CSSProperties = {
  ...plainButtonStyle,
  border: "1px solid rgba(77,163,245,0.45)",
  background: "rgba(77,163,245,0.16)",
  color: "var(--lx-primary-bright)",
};

const dangerButtonStyle: React.CSSProperties = {
  ...plainButtonStyle,
  border: "1px solid rgba(231,72,86,0.34)",
  background: "rgba(81,18,24,0.45)",
  color: "#FFD4D9",
};
