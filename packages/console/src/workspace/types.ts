export type WorkspaceWindowType =
  | "fixture-sheet"
  | "sequence-pool"
  | "sequence-sheet"
  | "dmx-sheet"
  | "playback"
  | "keyframe-editor"
  | "timecode"
  | "color-picker"
  | "groups"
  | "presets"
  | "shapers"
  | "layout";

export interface GridCell {
  x: number;
  y: number;
}

export interface GridRect extends GridCell {
  w: number;
  h: number;
}

export interface WorkspaceWindow extends GridRect {
  id: string;
  type: WorkspaceWindowType;
  config: Record<string, unknown>;
}

export interface WorkspaceWindowCatalogItem {
  type: WorkspaceWindowType;
  title: string;
  icon: string;
  accent: string;
  blurb: string;
  defaultSize: {
    w: number;
    h: number;
  };
  metrics: string[];
}
