import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const SETTINGS_WINDOW_LABEL = "settings";
const SETTINGS_QUERY = "/?window=settings";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function openSettingsWindow(): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);

      if (existing) {
        await existing.show();
        await existing.unminimize();
        await existing.setFocus();
        return;
      }

      const settingsWindow = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
        title: "LimxDesk Settings",
        url: SETTINGS_QUERY,
        width: 1180,
        height: 780,
        minWidth: 980,
        minHeight: 680,
        center: true,
        resizable: true,
        decorations: false,
        visible: true,
      });

      settingsWindow.once("tauri://error", (event) => {
        console.error("Failed to create settings window", event);
      });

      return;
    } catch (error) {
      console.error("Unable to open settings window", error);
      return;
    }
  }

  window.open(
    SETTINGS_QUERY,
    SETTINGS_WINDOW_LABEL,
    "popup=yes,width=1180,height=780,resizable=yes",
  );
}
