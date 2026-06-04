export type WorkspaceWindowType =
  | "fixture-sheet"
  | "playback"
  | "timecode"
  | "color-picker"
  | "groups"
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
