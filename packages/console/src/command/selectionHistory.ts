import { invoke } from "@tauri-apps/api/core";
import { pushCommandHistory } from "./commandRuntime";

export interface FixtureSelectionSnapshot {
  fixtureIds: string[];
  primaryFixtureId: string | null;
  version: number;
}

export async function runFixtureSelectionHistory(
  label: string,
  action: () => Promise<FixtureSelectionSnapshot>,
) {
  const before = await invoke<FixtureSelectionSnapshot>("fixture_selection_get");
  const after = await action();
  if (!fixtureSelectionEquals(before, after)) {
    pushCommandHistory({
      label,
      undo: () => restoreFixtureSelection(before),
      redo: () => restoreFixtureSelection(after),
    });
  }
  return after;
}

export async function restoreFixtureSelection(selection: FixtureSelectionSnapshot) {
  if (selection.fixtureIds.length === 0) {
    await invoke("fixture_selection_clear");
    return;
  }
  await invoke("fixture_selection_select", {
    fixtureIds: selection.fixtureIds,
    primaryFixtureId: selection.primaryFixtureId,
    mode: "replace",
  });
}

export function fixtureSelectionEquals(left: FixtureSelectionSnapshot, right: FixtureSelectionSnapshot) {
  if (left.primaryFixtureId !== right.primaryFixtureId) return false;
  if (left.fixtureIds.length !== right.fixtureIds.length) return false;
  return left.fixtureIds.every((id, index) => id === right.fixtureIds[index]);
}
