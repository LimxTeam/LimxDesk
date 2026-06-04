import { Titlebar } from "@limxdesk/shell";
import { useState } from "react";
import { Cable, LibraryBig } from "lucide-react";
import { ConnectivitySettingsPage } from "./pages/ConnectivitySettingsPage";
import { FixtureTypesSettingsPage } from "./pages/FixtureTypesSettingsPage";
import type { SettingsSection, SettingsSectionId } from "./types";

const SECTIONS: SettingsSection[] = [
  { id: "connectivity", label: "配接", caption: "网络、协议、适配器" },
  { id: "fixture-types", label: "灯具类型", caption: "库、模板、校验" },
];

const SECTION_ICONS = {
  connectivity: Cable,
  "fixture-types": LibraryBig,
} satisfies Record<SettingsSectionId, typeof Cable>;

export function SettingsApp() {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("connectivity");

  const section = SECTIONS.find((item) => item.id === activeSection) ?? SECTIONS[0];

  return (
    <div className="flex h-screen w-screen flex-col">
      <Titlebar hasActiveProject={false} projectName="Settings" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr)",
          minHeight: 0,
          flex: 1,
          background: "linear-gradient(180deg, #121212 0%, #17181d 100%)",
        }}
      >
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 18,
            borderRight: "1px solid var(--lx-stroke)",
            background:
              "linear-gradient(180deg, rgba(18, 18, 20, 0.98), rgba(24, 25, 31, 0.98))",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                color: "var(--lx-primary-bright)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              LimxDesk Settings
            </span>
            <h1
              style={{
                margin: 0,
                color: "var(--lx-fg-primary)",
                fontSize: 26,
                lineHeight: 1,
              }}
            >
              System Setup
            </h1>
            <p
              style={{
                margin: 0,
                color: "var(--lx-fg-secondary)",
                lineHeight: 1.6,
                fontSize: 12,
              }}
            >
              独立窗口，面向真实部署、灯具库和连接策略的常规软件设置界面。
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {SECTIONS.map((item) => {
              const Icon = SECTION_ICONS[item.id];
              const active = item.id === activeSection;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: "var(--lx-radius-md)",
                    border: active
                      ? "1px solid var(--lx-primary-trace)"
                      : "1px solid transparent",
                    background: active
                      ? "linear-gradient(180deg, rgba(0, 120, 212, 0.16), rgba(0, 120, 212, 0.06))"
                      : "transparent",
                    color: active
                      ? "var(--lx-fg-primary)"
                      : "var(--lx-fg-secondary)",
                    textAlign: "left",
                  }}
                >
                  <Icon
                    size={16}
                    style={{
                      marginTop: 1,
                      color: active
                        ? "var(--lx-primary-bright)"
                        : "var(--lx-fg-tertiary)",
                    }}
                  />
                  <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                    <span
                      style={{
                        color: active
                          ? "var(--lx-fg-secondary)"
                          : "var(--lx-fg-tertiary)",
                        fontSize: 11,
                      }}
                    >
                      {item.caption}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main
          style={{
            minWidth: 0,
            overflow: "auto",
            padding: 20,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            className="lx-panel"
            style={{
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background:
                "linear-gradient(180deg, rgba(34, 34, 34, 0.94), rgba(28, 28, 30, 0.98))",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "var(--lx-fg-primary)", fontSize: 14, fontWeight: 700 }}>
                {section.label}
              </span>
              <span style={{ color: "var(--lx-fg-tertiary)", fontSize: 11 }}>
                {section.caption}
              </span>
            </div>
            <span className="lx-badge lx-badge-info">UI Draft</span>
          </div>

          {activeSection === "connectivity" ? (
            <ConnectivitySettingsPage />
          ) : (
            <FixtureTypesSettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}
