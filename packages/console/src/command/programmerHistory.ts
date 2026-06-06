import { invoke } from "@tauri-apps/api/core";
import { pushCommandHistory } from "./commandRuntime";

export interface ProgrammerSnapshot {
  live: unknown;
  preview: unknown;
  mode: "live" | "preview";
  blind: boolean;
  version: number;
}

export async function runProgrammerHistory<TProgrammer extends ProgrammerSnapshot>(
  label: string,
  action: () => Promise<TProgrammer>,
) {
  const before = await invoke<TProgrammer>("programmer_get");
  const after = await action();
  pushCommandHistory({
    label,
    undo: () => invoke("programmer_replace_current", { programmer: before }),
    redo: () => invoke("programmer_replace_current", { programmer: after }),
  });
  return after;
}
