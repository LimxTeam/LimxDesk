import { invoke } from "@tauri-apps/api/core";

type CacheKey = "patch" | "fixtureTypes" | "selection" | "programmer" | "frames";

const values = new Map<CacheKey, unknown>();
const pending = new Map<CacheKey, Promise<unknown>>();

export function clearWorkspaceRuntimeCache(keys?: CacheKey[]) {
  const targetKeys = keys ?? ["patch", "fixtureTypes", "selection", "programmer", "frames"];
  for (const key of targetKeys) {
    values.delete(key);
    pending.delete(key);
  }
}

export function setWorkspaceRuntimeValue<T>(key: CacheKey, value: T) {
  values.set(key, value);
  pending.delete(key);
}

export function loadCachedPatch<T>() {
  return loadCached<T>("patch", "patch_load_current_show");
}

export function loadCachedFixtureTypes<T>() {
  return loadCached<T>("fixtureTypes", "fixture_type_scan_current_show");
}

export function loadCachedSelection<T>() {
  return loadCached<T>("selection", "fixture_selection_get");
}

export function loadCachedProgrammer<T>() {
  return loadCached<T>("programmer", "programmer_get");
}

export function loadCachedDmxFrames<T>() {
  return loadCached<T>("frames", "output_render_dmx");
}

function loadCached<T>(key: CacheKey, command: string): Promise<T> {
  if (values.has(key)) {
    return Promise.resolve(values.get(key) as T);
  }

  const existing = pending.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const request = invoke<T>(command).then((value) => {
    values.set(key, value);
    pending.delete(key);
    return value;
  });
  pending.set(key, request);
  return request;
}
