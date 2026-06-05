export interface NamedScribble {
  paths: string[];
  color: string;
  opacity: number;
}

export interface NamedImage {
  name: string;
  dataUrl: string;
  fit: "cover" | "contain";
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export interface NamedAppearanceVisibility {
  name: boolean;
  background: boolean;
  image: boolean;
  scribble: boolean;
}

export interface NamedAppearance {
  name: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  scribble: NamedScribble | null;
  image: NamedImage | null;
  visibility: NamedAppearanceVisibility;
}

export const NAMING_COLOR_SWATCHES = [
  "#1D2430",
  "#123D5A",
  "#17432A",
  "#4A3518",
  "#4A1C27",
  "#33215D",
  "#2F343A",
  "#0C3B3F",
  "#7A5A00",
  "#6B2737",
] as const;

export function createDefaultNamedAppearance(name = ""): NamedAppearance {
  return {
    name,
    backgroundColor: NAMING_COLOR_SWATCHES[0],
    textColor: "#F4F7FB",
    accentColor: "#4DA3F5",
    scribble: null,
    image: null,
    visibility: createDefaultVisibility(),
  };
}

export function normalizeNamedAppearance(
  appearance: Partial<NamedAppearance> | null | undefined,
  fallbackName = "",
): NamedAppearance {
  const defaults = createDefaultNamedAppearance(fallbackName);
  return {
    name: sanitizeName(appearance?.name ?? defaults.name),
    backgroundColor: sanitizeColor(appearance?.backgroundColor, defaults.backgroundColor),
    textColor: sanitizeColor(appearance?.textColor, defaults.textColor),
    accentColor: sanitizeColor(appearance?.accentColor, defaults.accentColor),
    scribble: normalizeScribble(appearance?.scribble),
    image: normalizeImage(appearance?.image),
    visibility: normalizeVisibility(appearance?.visibility),
  };
}

export function appearanceHasMedia(appearance: NamedAppearance): boolean {
  return Boolean(appearance.image?.dataUrl || appearance.scribble?.paths.length);
}

function sanitizeName(value: string): string {
  return value.trim().slice(0, 48);
}

function sanitizeColor(value: string | null | undefined, fallback: string): string {
  const color = value?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeScribble(value: NamedScribble | null | undefined): NamedScribble | null {
  const paths = value?.paths.filter((path) => path.trim().length > 0) ?? [];
  if (paths.length === 0) return null;
  return {
    paths,
    color: sanitizeColor(value?.color, "#F5B84D"),
    opacity: clamp(value?.opacity ?? 0.9, 0.05, 1),
  };
}

function normalizeImage(value: NamedImage | null | undefined): NamedImage | null {
  const dataUrl = value?.dataUrl.trim() ?? "";
  if (!dataUrl.startsWith("data:image/")) return null;
  return {
    name: value?.name.trim().slice(0, 96) ?? "",
    dataUrl,
    fit: value?.fit === "contain" ? "contain" : "cover",
    opacity: clamp(value?.opacity ?? 0.55, 0.05, 1),
    scale: clamp(value?.scale ?? 1, 0.2, 3),
    offsetX: clamp(value?.offsetX ?? 0, -100, 100),
    offsetY: clamp(value?.offsetY ?? 0, -100, 100),
    rotation: clamp(value?.rotation ?? 0, -180, 180),
  };
}

function createDefaultVisibility(): NamedAppearanceVisibility {
  return {
    name: true,
    background: true,
    image: true,
    scribble: true,
  };
}

function normalizeVisibility(
  value: Partial<NamedAppearanceVisibility> | null | undefined,
): NamedAppearanceVisibility {
  const defaults = createDefaultVisibility();
  return {
    name: value?.name ?? defaults.name,
    background: value?.background ?? defaults.background,
    image: value?.image ?? defaults.image,
    scribble: value?.scribble ?? defaults.scribble,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
