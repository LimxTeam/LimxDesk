import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
type ColorPickerMode = "cie" | "fader" | "book";
type ColorPickerSpace = "auto" | "rgb" | "cmy" | "rgbw";
type ColorPickerFixtureProfile = "auto" | "rgb" | "cmy" | "rgbw" | "rgba" | "rgbal";

interface ColorPickerState {
  mode: ColorPickerMode;
  constantBrightness: boolean;
  colorSpace: ColorPickerSpace;
  fixtureProfile: ColorPickerFixtureProfile;
  hue: number;
  saturation: number;
  brightness: number;
  warmth: number;
  values: Record<ColorChannelId, number>;
}

const GROUP_SLOT_COUNT = 255;
const PRESET_SLOT_COUNT = 120;
const COLOR_CHANNELS: ColorChannelId[] = ["R", "G", "B", "W", "C", "M", "Y", "A", "L"];
const COLOR_PICKER_MODES: Array<{ id: ColorPickerMode; label: string; hint: string }> = [
  { id: "cie", label: "CIE", hint: "Board" },
  { id: "fader", label: "Fader", hint: "Channels" },
  { id: "book", label: "Book", hint: "Swatches" },
];
const COLOR_SPACE_OPTIONS: Array<{ id: ColorPickerSpace; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "rgb", label: "RGB" },
  { id: "cmy", label: "CMY" },
  { id: "rgbw", label: "RGBW" },
];
const COLOR_FIXTURE_OPTIONS: Array<{ id: ColorPickerFixtureProfile; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "rgb", label: "RGB" },
  { id: "cmy", label: "CMY" },
  { id: "rgbw", label: "RGBW" },
  { id: "rgba", label: "RGBA" },
  { id: "rgbal", label: "RGBAL" },
];
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
  const [storeMode, setStoreMode] = useState(false);
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
    setStoreMode(false);
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

  function handleSlotClick(id: number, slot: GroupSlot | undefined) {
    if (storeMode) {
      storeSlot(id);
      return;
    }
    if (slot) {
      void recallSlot(slot);
    }
  }

  return (
    <ToolWindowShell
      title="Groups"
      subtitle={`${slots.length}/${GROUP_SLOT_COUNT} stored`}
      right={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className={storeMode ? "lx-btn lx-btn-primary" : "lx-btn lx-btn-ghost"}
            disabled={selection.fixtureIds.length === 0}
            onClick={() => setStoreMode((value) => !value)}
          >
            Store
          </button>
          <span className="lx-code">{selection.fixtureIds.length} selected</span>
        </div>
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "6px 8px",
          borderBottom: "1px solid var(--lx-stroke)",
          background: storeMode ? "rgba(245,184,77,0.10)" : "rgba(255,255,255,0.018)",
          color: storeMode ? "var(--lx-accent-bright)" : "var(--lx-fg-tertiary)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span>
          {storeMode
            ? "Store mode: click a slot to save current fixture selection"
            : "Recall mode: click stored groups to select fixtures"}
        </span>
        {storeMode ? (
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => setStoreMode(false)}>
            Cancel Store
          </button>
        ) : null}
      </div>
      <div style={poolGridStyle}>
        {Array.from({ length: GROUP_SLOT_COUNT }, (_, index) => {
          const id = index + 1;
          const slot = slots.find((item) => item.id === id);
          return (
            <PoolTileButton
              key={id}
              title={storeMode ? `Store Group ${id}` : slot ? `Recall Group ${id}` : `Empty Group ${id}`}
              onClick={() => handleSlotClick(id, slot)}
              onContextMenu={(event) => {
                event.preventDefault();
                setEditor(slot ?? createEmptyGroupSlot(id));
              }}
            >
              <NamedAppearanceTile
                appearance={slot?.appearance ?? createDefaultNamedAppearance(`Group ${id}`)}
                fallbackLabel={String(id)}
                empty={!slot}
                active={activeSlotId === id || storeMode}
                height={46}
                compact
              />
              <PoolMeta>
                {slot
                  ? `${slot.fixtureIds.length} fixtures`
                  : storeMode
                    ? "target"
                    : String(id)}
              </PoolMeta>
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
  const initialColorPickerState = normalizeColorPickerState(config);
  const [draft, setDraft] = useState<ColorPickerState>(() => initialColorPickerState);
  const draftRef = useRef<ColorPickerState>(initialColorPickerState);
  const supported = useMemo(() => mapColorAttributes(attributes), [attributes]);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const brightnessRailRef = useRef<HTMLDivElement | null>(null);
  const activeBoardPointerIdRef = useRef<number | null>(null);
  const activeBrightnessPointerIdRef = useRef<number | null>(null);
  const pendingApplyRef = useRef<ColorPickerState | null>(null);
  const applyInFlightRef = useRef(false);

  useEffect(() => {
    const next = normalizeColorPickerState(config);
    if (colorPickerSignature(next) === colorPickerSignature(draftRef.current)) return;
    draftRef.current = next;
    setDraft(next);
  }, [config.colorPicker, config.colorValues]);

  function commitDraft(next: ColorPickerState, send = true) {
    draftRef.current = next;
    setDraft(next);
    onConfigChange({
      ...config,
      colorPicker: next,
      colorValues: next.values,
    });
    if (send) {
      queueColorApply(next);
    }
  }

  function queueColorApply(next: ColorPickerState) {
    pendingApplyRef.current = next;
    if (applyInFlightRef.current) return;
    applyInFlightRef.current = true;
    void flushColorApplyQueue();
  }

  async function flushColorApplyQueue() {
    while (pendingApplyRef.current) {
      const next = pendingApplyRef.current;
      pendingApplyRef.current = null;
      const requests = buildColorRequests(next, supported);
      if (requests.length > 0 && selection.fixtureIds.length > 0) {
        await invoke("programmer_set_attributes_for_selection", { requests });
      }
    }
    applyInFlightRef.current = false;
  }

  function setChannel(channel: ColorChannelId, value: number) {
    const current = draftRef.current;
    const nextValues = { ...current.values, [channel]: clamp(value, 0, 100) };
    commitDraft(composeColorState(current, nextValues));
  }

  function applySwatch(swatch: (typeof COLOR_SWATCHES)[number]) {
    const current = draftRef.current;
    const nextValues = { ...current.values, ...swatch.values };
    commitDraft(composeColorState(current, nextValues));
  }

  function updateFromBoard(clientX: number, clientY: number) {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = normalizedPointInRect(clientX, clientY, rect);
    const hue = clamp(point.x * 360, 0, 360);
    const saturation = clamp(100 - point.y * 100, 0, 100);
    const current = draftRef.current;
    commitDraft(updateColorBoardState(current, { hue, saturation }));
  }

  function updateVerticalRail(
    ref: MutableRefObject<HTMLDivElement | null>,
    updater: (value: number) => void,
    clientY: number,
  ) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const value = clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100);
    updater(value);
  }

  function activateBoardDrag(event: ReactPointerEvent<HTMLDivElement>) {
    activeBoardPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromBoard(event.clientX, event.clientY);
  }

  function handleBoardPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeBoardPointerIdRef.current !== event.pointerId || (event.buttons & 1) === 0) return;
    updateFromBoard(event.clientX, event.clientY);
  }

  function endBoardDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeBoardPointerIdRef.current !== event.pointerId) return;
    activeBoardPointerIdRef.current = null;
  }

  function activateBrightnessDrag(event: ReactPointerEvent<HTMLDivElement>) {
    activeBrightnessPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextBrightness = (clientY: number) => {
      updateVerticalRail(brightnessRailRef, (value) => {
        const current = draftRef.current;
        commitDraft(updateColorBoardState(current, { brightness: value }));
      }, clientY);
    };
    nextBrightness(event.clientY);
  }

  function handleBrightnessPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeBrightnessPointerIdRef.current !== event.pointerId || (event.buttons & 1) === 0) return;
    updateVerticalRail(brightnessRailRef, (value) => {
      const current = draftRef.current;
      commitDraft(updateColorBoardState(current, { brightness: value }));
    }, event.clientY);
  }

  function endBrightnessDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeBrightnessPointerIdRef.current !== event.pointerId) return;
    activeBrightnessPointerIdRef.current = null;
  }

  return (
    <ToolWindowShell
      title="Special Dialog - Color Picker"
      subtitle={fixtureLabel}
      right={<span className="lx-code">{Object.values(supported).filter(Boolean).length}/9 attrs</span>}
    >
      <div style={colorPickerFrameStyle}>
        <div style={colorPickerCenterColumnStyle}>
          <div style={colorPickerTopBarStyle}>
            <div style={colorPickerModeBarStyle}>
              {COLOR_PICKER_MODES.map((mode) => (
                <ToggleButton
                  key={mode.id}
                  active={draft.mode === mode.id}
                  onClick={() => commitDraft({ ...draftRef.current, mode: mode.id }, false)}
                >
                  <span style={{ display: "grid", gap: 1 }}>
                    <span>{mode.label}</span>
                    <small className="lx-code" style={{ color: "inherit", fontSize: 9, opacity: 0.72 }}>{mode.hint}</small>
                  </span>
                </ToggleButton>
              ))}
              <ToggleButton
                active={draft.constantBrightness}
                onClick={() => {
                  const current = draftRef.current;
                  commitDraft(updateColorBoardState(current, { constantBrightness: !current.constantBrightness }));
                }}
              >
                Constant Brightness
              </ToggleButton>
            </div>

            <div style={colorPickerSelectGridStyle}>
              <label style={colorPickerSelectFieldStyle}>
                <span style={editorLabelStyle}>Color Space</span>
                <select
                  className="lx-input lx-input-sm"
                  value={draft.colorSpace}
                  onChange={(event) => {
                    const colorSpace = event.currentTarget.value;
                    if (!isColorSpaceMode(colorSpace)) return;
                    commitDraft(updateColorBoardState(draftRef.current, { colorSpace }));
                  }}
                >
                  {COLOR_SPACE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label style={colorPickerSelectFieldStyle}>
                <span style={editorLabelStyle}>Fixture Type</span>
                <select
                  className="lx-input lx-input-sm"
                  value={draft.fixtureProfile}
                  onChange={(event) => {
                    const fixtureProfile = event.currentTarget.value;
                    if (!isColorFixtureProfile(fixtureProfile)) return;
                    commitDraft({ ...draftRef.current, fixtureProfile });
                  }}
                >
                  {COLOR_FIXTURE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div style={colorPickerWorkspaceStyle}>
            {draft.mode === "cie" ? (
              <div style={colorPickerBoardStackStyle}>
                <div
                  ref={boardRef}
                  onPointerDown={activateBoardDrag}
                  onPointerMove={handleBoardPointerMove}
                  onPointerUp={endBoardDrag}
                  onPointerCancel={endBoardDrag}
                  style={colorBoardStyle(draft)}
                >
                  <div style={colorBoardPointerStyle(draft)} />
                </div>
                <div style={colorQuickStatsStyle}>
                  <NumberControl label="Hue" value={draft.hue} min={0} max={360} step={1} onChange={(value) => {
                    commitDraft(updateColorBoardState(draftRef.current, { hue: value }));
                  }} />
                  <NumberControl label="Sat" value={draft.saturation} min={0} max={100} step={1} onChange={(value) => {
                    commitDraft(updateColorBoardState(draftRef.current, { saturation: value }));
                  }} />
                  <NumberControl label="Bright" value={draft.brightness} min={0} max={100} step={1} onChange={(value) => {
                    commitDraft(updateColorBoardState(draftRef.current, { brightness: value }));
                  }} />
                  <NumberControl label="Warm" value={draft.warmth} min={0} max={100} step={1} onChange={(value) => {
                    commitDraft(updateColorBoardState(draftRef.current, { warmth: value }));
                  }} />
                </div>
              </div>
            ) : draft.mode === "fader" ? (
              <div style={colorFaderGridStyle}>
                {COLOR_CHANNELS.map((channel) => {
                  const attribute = supported[channel];
                  return (
                    <label key={channel} style={colorFaderRowStyle(!attribute)}>
                      <span style={editorLabelStyle}>{channel}</span>
                      <input
                        className="lx-input lx-input-sm"
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(draft.values[channel])}
                        disabled={!attribute}
                        onChange={(event) => {
                          const value = clamp(Number(event.currentTarget.value), 0, 100);
                          setChannel(channel, value);
                        }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={draft.values[channel]}
                        disabled={!attribute}
                        onChange={(event) => setChannel(channel, Number(event.currentTarget.value))}
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={swatchModeStyle}>
                <div style={swatchHeaderStyle}>
                  <strong style={editorSectionTitleStyle}>Color Book</strong>
                  <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>Tap a swatch to drive the active fixture color.</span>
                </div>
                <div style={swatchGridStyle}>
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.label}
                      type="button"
                      onClick={() => applySwatch(swatch)}
                      style={{
                        ...swatchButtonStyle,
                        minHeight: 64,
                        background: `linear-gradient(180deg, ${colorCss(swatch.values)}, rgba(0,0,0,0.85))`,
                      }}
                    >
                      <span>{swatch.label}</span>
                      <small className="lx-code" style={{ color: "rgba(255,255,255,0.76)", fontSize: 9 }}>
                        {Math.round(swatch.values.R)} / {Math.round(swatch.values.G)} / {Math.round(swatch.values.B)}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={colorPickerRightRailStyle}>
          <VerticalRail
            label="B"
            value={draft.brightness}
            onPointerDown={activateBrightnessDrag}
            onPointerMove={handleBrightnessPointerMove}
            onPointerUp={endBrightnessDrag}
            onPointerCancel={endBrightnessDrag}
            railRef={brightnessRailRef}
          />
          <div style={colorSupportCardStyle}>
            <div style={colorSupportListStyle}>
              {COLOR_CHANNELS.map((channel) => (
                <div key={channel} style={colorSupportRowStyle(Boolean(supported[channel]))}>
                  <span>{channel}</span>
                  <strong>{supported[channel] ? "On" : "Off"}</strong>
                </div>
              ))}
            </div>
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
  const [values, setValues] = useState<Record<ShaperControlId, number>>(() => normalizeShaperValues(config.shapers));
  const valuesRef = useRef<Record<ShaperControlId, number>>(values);
  const supported = useMemo(() => mapShaperAttributes(attributes), [attributes]);
  const supportedRef = useRef(supported);
  const padRef = useRef<HTMLDivElement | null>(null);
  const activeShaperDragRef = useRef<{ pointerId: number; control: ShaperControlId } | null>(null);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  useEffect(() => {
    supportedRef.current = supported;
  }, [supported]);

  function updateValues(nextValues: Record<ShaperControlId, number>) {
    valuesRef.current = nextValues;
    setValues(nextValues);
    onConfigChange({ ...config, shapers: nextValues });
  }

  async function setControl(control: ShaperControlId, value: number) {
    const nextValues = { ...valuesRef.current, [control]: clamp(value, 0, 100) };
    updateValues(nextValues);
    const attribute = supportedRef.current[control];
    if (!attribute || selection.fixtureIds.length === 0) return;
    await setProgrammerAttribute(attribute, nextValues[control], "manual");
  }

  function updateBladeFromPointer(control: ShaperControlId, clientX: number, clientY: number) {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = normalizedPointInRect(clientX, clientY, rect);
    const x = point.x * 100;
    const y = point.y * 100;
    if (control === "top") void setControl(control, y);
    if (control === "bottom") void setControl(control, 100 - y);
    if (control === "left") void setControl(control, x);
    if (control === "right") void setControl(control, 100 - x);
  }

  function beginShaperDrag(control: ShaperControlId, event: ReactPointerEvent<HTMLDivElement>) {
    if (!supportedRef.current[control]) return;
    activeShaperDragRef.current = { pointerId: event.pointerId, control };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateBladeFromPointer(control, event.clientX, event.clientY);
  }

  function moveShaperDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = activeShaperDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
    updateBladeFromPointer(drag.control, event.clientX, event.clientY);
  }

  function endShaperDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeShaperDragRef.current?.pointerId !== event.pointerId) return;
    activeShaperDragRef.current = null;
  }

  return (
    <ToolWindowShell
      title="Shapers"
      subtitle={fixtureLabel}
      right={<span className="lx-code">{Object.values(supported).filter(Boolean).length}/7 attrs</span>}
    >
      <div style={shaperFrameStyle}>
        <div
          ref={padRef}
          onPointerMove={moveShaperDrag}
          onPointerUp={endShaperDrag}
          onPointerCancel={endShaperDrag}
          style={shaperPadStyle}
        >
          <div style={shaperBeamStyle} />
          <BladeHandle side="top" value={values.top} disabled={!supported.top} onPointerDown={(event) => beginShaperDrag("top", event)} />
          <BladeHandle side="bottom" value={values.bottom} disabled={!supported.bottom} onPointerDown={(event) => beginShaperDrag("bottom", event)} />
          <BladeHandle side="left" value={values.left} disabled={!supported.left} onPointerDown={(event) => beginShaperDrag("left", event)} />
          <BladeHandle side="right" value={values.right} disabled={!supported.right} onPointerDown={(event) => beginShaperDrag("right", event)} />
          <div style={shaperApertureGuideStyle} />
          <div style={shaperCenterMarkStyle} />
        </div>
        <div style={shaperControlPanelStyle}>
          <div style={shaperControlHeaderStyle}>
            <strong style={editorSectionTitleStyle}>Shaper</strong>
            <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>{fixtureLabel}</span>
          </div>
          {(["top", "bottom", "left", "right", "iris", "rotate", "soft"] as ShaperControlId[]).map((control) => (
            <label key={control} style={shaperControlRowStyle(!supported[control])}>
              <span>{shaperControlLabel(control)}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={values[control]}
                disabled={!supported[control]}
                onChange={(event) => void setControl(control, Number(event.currentTarget.value))}
              />
              <input
                className="lx-input lx-input-sm"
                type="number"
                min={0}
                max={100}
                value={Math.round(values[control])}
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

function normalizeColorPickerState(value: unknown): ColorPickerState {
  const record = asRecord(value);
  const source = asRecord(record.colorPicker);
  const values = normalizeColorValues(source.values ?? source.colorValues ?? record.values ?? record.colorValues ?? record);
  const derived = deriveColorStateFromValues(values);
  const modeValue = source.mode ?? record.mode;
  const colorSpaceValue = source.colorSpace ?? record.colorSpace;
  const fixtureProfileValue = source.fixtureProfile ?? record.fixtureProfile;
  const colorSpace: ColorPickerSpace = isColorSpaceMode(colorSpaceValue) ? colorSpaceValue : "auto";
  const fixtureProfile: ColorPickerFixtureProfile = isColorFixtureProfile(fixtureProfileValue) ? fixtureProfileValue : "auto";
  return {
    mode: isColorPickerMode(modeValue) ? modeValue : "cie",
    constantBrightness: Boolean(source.constantBrightness ?? record.constantBrightness ?? false),
    colorSpace,
    fixtureProfile,
    hue: clampNumber(source.hue ?? record.hue ?? derived.hue, 0, 360),
    saturation: clampNumber(source.saturation ?? record.saturation ?? derived.saturation, 0, 100),
    brightness: clampNumber(source.brightness ?? record.brightness ?? derived.brightness, 0, 100),
    warmth: clampNumber(source.warmth ?? record.warmth ?? derived.warmth, 0, 100),
    values,
  };
}

function colorPickerSignature(state: ColorPickerState) {
  return JSON.stringify({
    mode: state.mode,
    constantBrightness: state.constantBrightness,
    colorSpace: state.colorSpace,
    fixtureProfile: state.fixtureProfile,
    hue: state.hue,
    saturation: state.saturation,
    brightness: state.brightness,
    warmth: state.warmth,
    values: state.values,
  });
}

function deriveColorStateFromValues(values: Record<ColorChannelId, number>) {
  const rgb = rgbFromColorValues(values);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const warmth = clamp(Math.round((values.A * 0.85 + values.L * 0.35 + values.W * 0.25) - values.B * 0.15), 0, 100);
  return {
    hue: hsv.h,
    saturation: hsv.s,
    brightness: clamp(Math.round(Math.max(hsv.v, values.W, values.A, values.L)), 0, 100),
    warmth,
  };
}

function deriveColorValuesFromBoard(
  state: Pick<ColorPickerState, "hue" | "saturation" | "brightness" | "warmth" | "colorSpace" | "constantBrightness">,
) {
  const rgb = hsvToRgb(state.hue, state.saturation, state.brightness);
  const constantBrightnessBias = state.constantBrightness ? 0.68 : 1;
  const white = clamp(Math.round(state.brightness * (1 - state.saturation / 140) * constantBrightnessBias), 0, 100);
  const warmth = clamp(state.warmth / 100, 0, 1);
  const complement = {
    c: clamp(100 - rgb.r, 0, 100),
    m: clamp(100 - rgb.g, 0, 100),
    y: clamp(100 - rgb.b, 0, 100),
  };
  const space = state.colorSpace;
  const rgbwBias = space === "rgbw" ? 0.75 : 0.45;
  const cmyBias = space === "cmy" ? 0.92 : 0.66;
  const chromaBias = state.constantBrightness ? 0.62 : 1;
  const amber = clamp(Math.round(state.brightness * (0.2 + warmth * 0.8) * chromaBias), 0, 100);
  const lime = clamp(Math.round(state.brightness * (0.16 + (1 - warmth) * 0.62) * chromaBias), 0, 100);
  return {
    R: clamp(Math.round(rgb.r * (space === "cmy" ? 0.64 : 1)), 0, 100),
    G: clamp(Math.round(rgb.g * (space === "cmy" ? 0.64 : 1)), 0, 100),
    B: clamp(Math.round(rgb.b * (space === "cmy" ? 0.64 : 1)), 0, 100),
    W: clamp(Math.round(white * rgbwBias), 0, 100),
    C: clamp(Math.round(complement.c * cmyBias), 0, 100),
    M: clamp(Math.round(complement.m * cmyBias), 0, 100),
    Y: clamp(Math.round(complement.y * cmyBias), 0, 100),
    A: amber,
    L: lime,
  } satisfies Record<ColorChannelId, number>;
}

function rgbFromColorValues(values: Record<ColorChannelId, number>) {
  const r = clamp(Math.round(values.R + values.A * 0.7 + values.W * 0.3), 0, 100);
  const g = clamp(Math.round(values.G + values.L * 0.55 + values.W * 0.3), 0, 100);
  const b = clamp(Math.round(values.B + values.W * 0.35), 0, 100);
  return { r, g, b };
}

function rgbToHsv(r: number, g: number, b: number) {
  const rn = clamp(r, 0, 100) / 100;
  const gn = clamp(g, 0, 100) / 100;
  const bn = clamp(b, 0, 100) / 100;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === rn) hue = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) hue = 60 * ((bn - rn) / delta + 2);
    else hue = 60 * ((rn - gn) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = max === 0 ? 0 : (delta / max) * 100;
  const brightness = max * 100;
  return {
    h: clamp(Math.round(hue), 0, 360),
    s: clamp(Math.round(saturation), 0, 100),
    v: clamp(Math.round(brightness), 0, 100),
  };
}

function composeColorState(base: ColorPickerState, values: Record<ColorChannelId, number>): ColorPickerState {
  const derived = deriveColorStateFromValues(values);
  return {
    ...base,
    values,
    hue: derived.hue,
    saturation: derived.saturation,
    brightness: derived.brightness,
    warmth: derived.warmth,
  };
}

function updateColorBoardState(base: ColorPickerState, patch: Partial<Omit<ColorPickerState, "values" | "mode" | "fixtureProfile">>): ColorPickerState {
  const next = {
    ...base,
    ...patch,
    hue: clamp(patch.hue ?? base.hue, 0, 360),
    saturation: clamp(patch.saturation ?? base.saturation, 0, 100),
    brightness: clamp(patch.brightness ?? base.brightness, 0, 100),
    warmth: clamp(patch.warmth ?? base.warmth, 0, 100),
  };
  return {
    ...next,
    values: deriveColorValuesFromBoard(next),
  };
}

function hsvToRgb(h: number, s: number, v: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const value = clamp(v, 0, 100) / 100;
  const c = value * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    [r, g, b] = [c, x, 0];
  } else if (hue < 120) {
    [r, g, b] = [x, c, 0];
  } else if (hue < 180) {
    [r, g, b] = [0, c, x];
  } else if (hue < 240) {
    [r, g, b] = [0, x, c];
  } else if (hue < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
  return {
    r: clamp(Math.round((r + m) * 100), 0, 100),
    g: clamp(Math.round((g + m) * 100), 0, 100),
    b: clamp(Math.round((b + m) * 100), 0, 100),
  };
}

function buildColorRequests(
  state: ColorPickerState,
  supported: Record<ColorChannelId, FixtureModeAttribute | null>,
) {
  const values = state.values;
  const requestedChannels = resolveColorChannelPriority(state.fixtureProfile, supported);
  const requests: Array<{
    attribute: string;
    featureGroup: string;
    layer: "absolute";
    value: { numeric: number | null; text: null };
    source: "manual";
  }> = [];
  for (const channel of requestedChannels) {
    const attribute = supported[channel];
    if (!attribute) continue;
    requests.push({
      attribute: attribute.name,
      featureGroup: attribute.featureGroup,
      layer: "absolute",
      value: { numeric: clamp(Math.round(values[channel]), 0, 100), text: null },
      source: "manual",
    });
  }
  return requests;
}

function resolveColorChannelPriority(
  profile: ColorPickerFixtureProfile,
  supported: Record<ColorChannelId, FixtureModeAttribute | null>,
) {
  if (profile === "auto") {
    return colorChannelPriorityForProfile(detectFixtureColorProfile(supported));
  }
  return colorChannelPriorityForProfile(profile);
}

function detectFixtureColorProfile(supported: Record<ColorChannelId, FixtureModeAttribute | null>): Exclude<ColorPickerFixtureProfile, "auto"> {
  const hasRgb = Boolean(supported.R || supported.G || supported.B);
  const hasCmy = Boolean(supported.C || supported.M || supported.Y);
  const hasWhite = Boolean(supported.W);
  const hasAmber = Boolean(supported.A);
  const hasLime = Boolean(supported.L);
  if (hasRgb && hasCmy && hasWhite && hasAmber && hasLime) return "rgbal";
  if (hasRgb && hasAmber && hasLime) return "rgba";
  if (hasRgb && hasWhite) return "rgbw";
  if (hasRgb) return "rgb";
  if (hasCmy && hasWhite) return "rgbw";
  if (hasCmy) return "cmy";
  if (hasWhite) return "rgbw";
  if (hasAmber || hasLime) return hasAmber && hasLime ? "rgbal" : "rgba";
  return "rgb";
}

function colorChannelPriorityForProfile(profile: Exclude<ColorPickerFixtureProfile, "auto">) {
  if (profile === "rgb") return ["R", "G", "B", "W", "A", "L", "C", "M", "Y"] as ColorChannelId[];
  if (profile === "cmy") return ["C", "M", "Y", "W", "A", "L", "R", "G", "B"] as ColorChannelId[];
  if (profile === "rgbw") return ["R", "G", "B", "W", "A", "L", "C", "M", "Y"] as ColorChannelId[];
  if (profile === "rgba") return ["R", "G", "B", "A", "L", "W", "C", "M", "Y"] as ColorChannelId[];
  if (profile === "rgbal") return ["R", "G", "B", "A", "L", "W", "C", "M", "Y"] as ColorChannelId[];
  return [...COLOR_CHANNELS];
}

function isColorPickerMode(value: unknown): value is ColorPickerMode {
  return value === "cie" || value === "fader" || value === "book";
}

function isColorSpaceMode(value: unknown): value is ColorPickerSpace {
  return value === "auto" || value === "rgb" || value === "cmy" || value === "rgbw";
}

function isColorFixtureProfile(value: unknown): value is ColorPickerFixtureProfile {
  return value === "auto" || value === "rgb" || value === "cmy" || value === "rgbw" || value === "rgba" || value === "rgbal";
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

function normalizedPointInRect(clientX: number, clientY: number, rect: DOMRect) {
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  return {
    x: clamp((clientX - rect.left) / width, 0, 1),
    y: clamp((clientY - rect.top) / height, 0, 1),
  };
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

function VerticalRail({
  label,
  value,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  railRef,
}: {
  label: string;
  value: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  railRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const railValue = clamp(value, 0, 100);
  return (
    <div style={verticalRailShellStyle}>
      <span style={verticalRailLabelStyle}>{label}</span>
      <div
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={verticalRailTrackStyle}
      >
        <div style={{ ...verticalRailFillStyle, height: `${railValue}%` }} />
      </div>
      <span className="lx-code" style={verticalRailValueStyle}>{Math.round(value)}</span>
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={miniNumberControlStyle}>
      <span style={editorLabelStyle}>{label}</span>
      <input
        className="lx-input lx-input-sm"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Math.round(value)}
        onChange={(event) => onChange(clamp(Number(event.currentTarget.value), min, max))}
      />
    </label>
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
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const common: React.CSSProperties = {
    position: "absolute",
    background: disabled ? "rgba(255,255,255,0.16)" : "rgba(101,212,199,0.82)",
    border: "1px solid rgba(255,255,255,0.45)",
    cursor: disabled ? "not-allowed" : side === "left" || side === "right" ? "ew-resize" : "ns-resize",
    display: "grid",
    placeItems: "center",
    color: "#050708",
    fontSize: 9,
    fontWeight: 900,
    userSelect: "none",
    touchAction: "none",
  };
  const style: React.CSSProperties =
    side === "top"
      ? { ...common, left: "12%", right: "12%", top: `${value}%`, height: 12, transform: "translateY(-50%)" }
      : side === "bottom"
        ? { ...common, left: "12%", right: "12%", bottom: `${value}%`, height: 12, transform: "translateY(50%)" }
        : side === "left"
          ? { ...common, top: "12%", bottom: "12%", left: `${value}%`, width: 12, transform: "translateX(-50%)" }
          : { ...common, top: "12%", bottom: "12%", right: `${value}%`, width: 12, transform: "translateX(50%)" };
  return (
    <div style={style} onPointerDown={(event) => !disabled && onPointerDown(event)}>
      {side === "top" ? "1A" : side === "bottom" ? "1B" : side === "left" ? "2A" : "2B"}
    </div>
  );
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

const editorSectionTitleStyle: React.CSSProperties = {
  color: "var(--lx-fg-primary)",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
};

const editorLabelStyle: React.CSSProperties = {
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const miniNumberControlStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const colorPickerFrameStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 96px",
  gap: 8,
  minHeight: 0,
  height: "100%",
};

const colorPickerCenterColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 6,
  minHeight: 0,
};

const colorPickerTopBarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(220px, 1fr)",
  gap: 8,
  alignItems: "end",
};

const colorPickerModeBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  alignItems: "flex-start",
};

const colorPickerSelectGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const colorPickerSelectFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const colorPickerWorkspaceStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "hidden",
};

const colorPickerBoardStackStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto",
  gap: 6,
  minHeight: 0,
  height: "100%",
};

function colorBoardStyle(state: ColorPickerState): React.CSSProperties {
  return {
    position: "relative",
    minHeight: 0,
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-md)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.92) 100%), linear-gradient(90deg, #ff0000 0%, #ffff00 16.6%, #00ff00 33.2%, #00ffff 49.8%, #0000ff 66.4%, #ff00ff 83.1%, #ff0000 100%)",
    boxShadow: `inset 0 0 0 1px ${colorCss(state.values)}`,
    cursor: "crosshair",
  };
}

function colorBoardPointerStyle(state: ColorPickerState): React.CSSProperties {
  return {
    position: "absolute",
    left: `${clamp(state.hue / 360, 0, 1) * 100}%`,
    top: `${100 - clamp(state.saturation, 0, 100)}%`,
    width: 10,
    height: 10,
    transform: "translate(-50%, -50%)",
    borderRadius: "50%",
    background: "rgba(255,255,255,0.96)",
    border: "1px solid rgba(0,0,0,0.68)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.32), 0 0 8px rgba(0,0,0,0.45)",
    pointerEvents: "none",
  };
}

const colorQuickStatsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
};

const colorFaderGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 6,
  alignContent: "start",
  minHeight: 0,
  overflow: "auto",
};

function colorFaderRowStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "16px 46px minmax(0, 1fr)",
    gap: 6,
    alignItems: "center",
    minWidth: 0,
    padding: 6,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-sm)",
    background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
    opacity: disabled ? 0.38 : 1,
  };
}

const swatchModeStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  minHeight: 0,
};

const swatchHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 10,
};

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
  display: "grid",
  gap: 3,
  alignContent: "center",
  padding: "8px 10px",
  textAlign: "left",
};

const colorPickerRightRailStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "minmax(150px, 1fr) auto",
  gap: 6,
  minHeight: 0,
  overflow: "auto",
  paddingLeft: 0,
};

const colorSupportCardStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: 6,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-sm)",
  background: "rgba(255,255,255,0.02)",
};

const colorSupportListStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
};

function colorSupportRowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "5px 6px",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "var(--lx-radius-xs)",
    background: active ? "rgba(77,163,245,0.12)" : "rgba(0,0,0,0.18)",
    color: active ? "var(--lx-primary-bright)" : "var(--lx-fg-tertiary)",
    fontSize: 10,
  };
}

const shaperFrameStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 1fr) 220px",
  gap: 10,
  minHeight: 0,
  height: "100%",
};

const shaperPadStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  border: "1px solid rgba(101,212,199,0.28)",
  borderRadius: "var(--lx-radius-md)",
  background:
    "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.10), rgba(0,0,0,0) 44%), linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005)), #030405",
  minHeight: 0,
};

const shaperApertureGuideStyle: React.CSSProperties = {
  position: "absolute",
  inset: "14%",
  border: "1px dashed rgba(255,255,255,0.18)",
  boxShadow: "inset 0 0 30px rgba(255,255,255,0.035)",
  pointerEvents: "none",
};

const shaperCenterMarkStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 10,
  height: 10,
  transform: "translate(-50%, -50%)",
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,0.36)",
  background: "rgba(0,0,0,0.34)",
  pointerEvents: "none",
};

const shaperControlPanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto repeat(7, auto)",
  gap: 6,
  alignContent: "start",
  minHeight: 0,
  overflow: "auto",
};

const shaperControlHeaderStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
  padding: 8,
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "var(--lx-radius-md)",
  background: "rgba(255,255,255,0.025)",
};

function shaperControlRowStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "46px minmax(0, 1fr) 48px 28px",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    padding: 5,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "var(--lx-radius-sm)",
    background: disabled ? "rgba(255,255,255,0.015)" : "rgba(255,255,255,0.035)",
    opacity: disabled ? 0.38 : 1,
    color: "var(--lx-fg-secondary)",
    fontSize: 10,
    fontWeight: 800,
  };
}

function shaperControlLabel(control: ShaperControlId) {
  if (control === "top") return "Top";
  if (control === "bottom") return "Bottom";
  if (control === "left") return "Left";
  if (control === "right") return "Right";
  if (control === "iris") return "Iris";
  if (control === "rotate") return "Rotate";
  return "Soft";
}

const verticalRailShellStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: 6,
  alignItems: "center",
  minHeight: 0,
};

const verticalRailLabelStyle: React.CSSProperties = {
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  textAlign: "center",
};

const verticalRailTrackStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 180,
  borderRadius: "var(--lx-radius-sm)",
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.24) 46%, rgba(0,0,0,0.92) 100%)",
  overflow: "hidden",
  cursor: "ns-resize",
  padding: "5px 0",
};

const verticalRailFillStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  background: "linear-gradient(180deg, rgba(168,78,237,0.84), rgba(77,163,245,0.58))",
};

const verticalRailValueStyle: React.CSSProperties = {
  color: "var(--lx-fg-tertiary)",
  fontSize: 10,
  fontWeight: 800,
  textAlign: "center",
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
