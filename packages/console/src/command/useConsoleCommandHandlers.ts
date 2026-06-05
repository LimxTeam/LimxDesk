import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  commandSlotNumber,
  registerCommandHandler,
  type DeskCommandState,
} from "./commandRuntime";

interface SequenceLoadResult {
  document: SequenceDocument;
}

interface SequenceDocument {
  sequences: SequenceModel[];
  selectedSequenceId: string | null;
}

interface SequenceModel {
  id: string;
  number: number;
  name: string;
}

interface PlaybackDocument {
  pages: PlaybackPage[];
  selectedPageId: string | null;
}

interface PlaybackPage {
  id: string;
  number: number;
  executors: ExecutorModel[];
}

interface ExecutorModel {
  id: string;
  number: number;
}

export function useConsoleCommandHandlers() {
  useEffect(() => {
    return registerCommandHandler("console-global-objects", async (command) => {
      if (command.target === "sequence") {
        return handleSequenceCommand(command);
      }
      if (command.target === "executor") {
        return handleExecutorCommand(command);
      }
      return false;
    });
  }, []);
}

async function handleSequenceCommand(command: DeskCommandState) {
  const number = commandSlotNumber(command);
  if (!number || number < 1) {
    return { handled: true, keepCommand: true, status: "Sequence command needs a pool number" };
  }

  const result = await invoke<SequenceLoadResult>("sequence_load_current_show");
  const existing = result.document.sequences.find((sequence) => sequence.number === number);

  if (command.mode === "store" || command.mode === "update") {
    await invoke("sequence_store_single_step_program", {
      request: {
        sequenceId: existing?.id ?? null,
        sequenceNumber: number,
        name: existing?.name ?? `Sequence ${number}`,
        storeMode: command.mode === "update" ? "overwrite" : "merge",
      },
    });
    return { handled: true, status: `${command.mode === "update" ? "Updated" : "Stored"} Sequence ${number}` };
  }

  if (command.mode === "delete") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: `Sequence ${number} is empty` };
    }
    await invoke("sequence_delete", { sequenceId: existing.id });
    return { handled: true, status: `Deleted Sequence ${number}` };
  }

  if (command.mode === "select" || command.mode === "idle") {
    if (!existing) {
      return { handled: true, keepCommand: true, status: `Sequence ${number} is empty` };
    }
    await invoke("sequence_select", { sequenceId: existing.id });
    return { handled: true, status: `Selected Sequence ${number}` };
  }

  return false;
}

async function handleExecutorCommand(command: DeskCommandState) {
  const number = commandSlotNumber(command);
  if (!number) {
    return { handled: true, keepCommand: true, status: "Executor command needs an executor number" };
  }

  const playback = await invoke<PlaybackDocument>("playback_load_current_show");
  const page =
    playback.pages.find((item) => item.id === playback.selectedPageId) ??
    playback.pages[0] ??
    null;
  const executor = page?.executors.find((item) => item.number === number) ?? null;
  if (!page || !executor) {
    return { handled: true, keepCommand: true, status: `Executor ${number} not found` };
  }

  if (command.mode === "store" || command.mode === "update") {
    await invoke("playback_store_programmer_on_executor", {
      pageId: page.id,
      executorId: executor.id,
      storeMode: command.mode === "update" ? "overwrite" : "merge",
    });
    return { handled: true, status: `${command.mode === "update" ? "Updated" : "Stored"} Executor ${number}` };
  }

  if (command.mode === "delete") {
    await invoke("playback_clear_executor", {
      pageId: page.id,
      executorId: executor.id,
    });
    return { handled: true, status: `Cleared Executor ${number}` };
  }

  if (command.mode === "on" || command.mode === "off") {
    await invoke("playback_fire_executor", {
      pageId: page.id,
      executorId: executor.id,
      action: command.mode === "on" ? "go" : "off",
    });
    return { handled: true, status: `${command.mode === "on" ? "Go" : "Off"} Executor ${number}` };
  }

  if (command.mode === "select" || command.mode === "idle") {
    return { handled: true, status: `Selected Executor ${number}` };
  }

  return false;
}
