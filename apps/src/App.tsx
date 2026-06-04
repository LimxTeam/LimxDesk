import { Titlebar } from "@limxdesk/shell";
import { DynamicIsland, dynamicIsland } from "@limxdesk/notifications";
import { ConsoleShell } from "@limxdesk/console";
import { SettingsApp } from "@limxdesk/settings";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export default function App() {
  const mode = new URLSearchParams(window.location.search).get("window");

  // 启动时展示灵动岛欢迎通知
  useEffect(() => {
    if (mode === "settings") return;

    dynamicIsland.show({
      type: "success",
      title: "LimxDesk 已就绪",
      subtitle: "骨架搭建完成，等待业务填充",
      progress: 1,
      duration: 2400,
    });
  }, [mode]);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const loaded = await listen<ShowEventPayload>("show:loaded", (event) => {
        dynamicIsland.show({
          type: "success",
          title: "Show 已加载",
          subtitle: event.payload.name,
          duration: 2200,
        });
      });
      const saved = await listen<ShowEventPayload>("show:saved", (event) => {
        dynamicIsland.show({
          type: "success",
          title: "Show 已保存",
          subtitle: event.payload.name,
          duration: 1800,
        });
      });
      const deleted = await listen<{ path: string }>("show:deleted", (event) => {
        dynamicIsland.show({
          type: "warning",
          title: "Show 已删除",
          subtitle: event.payload.path,
          duration: 2600,
        });
      });

      if (!active) {
        loaded();
        saved();
        deleted();
        return;
      }
      unlisteners.push(loaded, saved, deleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  if (mode === "settings") {
    return (
      <>
        <SettingsApp />
        <DynamicIsland />
      </>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <Titlebar
        hasActiveProject={false}
        onProjectNew={() => {
          dynamicIsland.show({
            type: "loading",
            title: "新建项目",
            subtitle: "项目功能尚未实现",
            duration: 2000,
          });
        }}
        onProjectOpen={() => {
          dynamicIsland.show({
            type: "loading",
            title: "打开项目",
            subtitle: "项目功能尚未实现",
            duration: 2000,
          });
        }}
      />

      {/* DMX 控台五区布局 */}
      <div className="flex min-h-0 flex-1">
        <ConsoleShell>
          {/* 中央画布 — 后续填充 3D 视图 / Fixture 布局 */}
        </ConsoleShell>
      </div>

      {/* 全局灵动岛通知 */}
      <DynamicIsland />
    </div>
  );
}

interface ShowEventPayload {
  id: string;
  name: string;
  path: string;
}
