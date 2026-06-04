import { Titlebar } from "@limxdesk/shell";
import { DynamicIsland, dynamicIsland } from "@limxdesk/notifications";
import { ConsoleShell } from "@limxdesk/console";
import { SettingsApp } from "@limxdesk/settings";
import { useEffect } from "react";

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
