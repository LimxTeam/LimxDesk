import type { WorkspaceWindowCatalogItem, WorkspaceWindowType } from "./types";

export const WORKSPACE_WINDOW_CATALOG: WorkspaceWindowCatalogItem[] = [
  {
    type: "fixture-sheet",
    title: "Fixture Sheet",
    icon: "FS",
    accent: "#4DA3F5",
    blurb: "Patch, inspect, and align fixture parameters in a dense engineer view.",
    defaultSize: { w: 8, h: 5 },
    metrics: ["Universe", "Address", "Mode"],
  },
  {
    type: "dmx-sheet",
    title: "DMX Sheet",
    icon: "DX",
    accent: "#78D978",
    blurb: "Rendered DMX universe monitor driven by patch, GDTF defaults, and programmer output.",
    defaultSize: { w: 9, h: 6 },
    metrics: ["Universe", "Channel", "Value"],
  },
  {
    type: "playback",
    title: "Playback",
    icon: "PB",
    accent: "#78D978",
    blurb: "Playback buttons and executor cells for cue stacks and live takeover.",
    defaultSize: { w: 8, h: 6 },
    metrics: ["Pages", "Executors", "Flash"],
  },
  {
    type: "timecode",
    title: "Timecode",
    icon: "TC",
    accent: "#F5B84D",
    blurb: "Clock-aligned trigger view for timeline lock, offsets, and sync health.",
    defaultSize: { w: 7, h: 4 },
    metrics: ["LTC", "MTC", "Offset"],
  },
  {
    type: "color-picker",
    title: "Color Picker",
    icon: "CP",
    accent: "#E868A2",
    blurb: "Fast color selection surface for additive, subtractive, and gel workflows.",
    defaultSize: { w: 6, h: 5 },
    metrics: ["RGB", "CMY", "Gel"],
  },
  {
    type: "presets",
    title: "Preset Pool",
    icon: "PR",
    accent: "#F5B84D",
    blurb: "Store and recall programmer values by attribute family.",
    defaultSize: { w: 7, h: 5 },
    metrics: ["All", "Position", "Shapers"],
  },
  {
    type: "shapers",
    title: "Shapers",
    icon: "SH",
    accent: "#65D4C7",
    blurb: "Dedicated cutter and blade control surface for profile fixtures.",
    defaultSize: { w: 6, h: 5 },
    metrics: ["Blade", "Iris", "Rotate"],
  },
  {
    type: "groups",
    title: "Groups",
    icon: "GR",
    accent: "#AA8EFF",
    blurb: "Quick selection bank for rigs, layers, positions, and bus routing.",
    defaultSize: { w: 6, h: 4 },
    metrics: ["Select", "Bus", "Tags"],
  },
  {
    type: "layout",
    title: "Layout",
    icon: "LY",
    accent: "#65D4C7",
    blurb: "Spatial overview canvas for fixture blocks, stage zones, and annotations.",
    defaultSize: { w: 9, h: 6 },
    metrics: ["Stage", "Pixel", "Focus"],
  },
];

export function getWorkspaceWindowItem(
  type: WorkspaceWindowType,
): WorkspaceWindowCatalogItem {
  return (
    WORKSPACE_WINDOW_CATALOG.find((item) => item.type === type) ??
    WORKSPACE_WINDOW_CATALOG[0]
  );
}
