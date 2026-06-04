import { WindowChrome } from "@limxdesk/shell";
import { useState } from "react";
import { LibraryBig, PlugZap } from "lucide-react";
import { ConnectivitySettingsPage } from "./pages/ConnectivitySettingsPage";
import { FixtureTypesSettingsPage } from "./pages/FixtureTypesSettingsPage";
import type { SettingsSection, SettingsSectionId } from "./types";

const SECTIONS: SettingsSection[] = [
  { id: "patch", label: "配接", caption: "灯具、地址、舞台" },
  { id: "fixture-types", label: "灯具类型", caption: "资料库、模式、通道" },
];

const SECTION_ICONS = {
  patch: PlugZap,
  "fixture-types": LibraryBig,
} satisfies Record<SettingsSectionId, typeof PlugZap>;

export function SettingsApp() {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("patch");

  const section = SECTIONS.find((item) => item.id === activeSection) ?? SECTIONS[0];

  return (
    <WindowChrome title="LimxDesk 设置" subtitle={section.label}>
      <div
        style={{
          display: "grid",
          width: "100%",
          height: "100%",
          gridTemplateColumns: "244px minmax(0, 1fr)",
          background:
            "linear-gradient(180deg, rgba(15,15,17,0.98), rgba(20,21,25,0.98))",
        }}
      >
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: "18px 14px",
            borderRight: "1px solid var(--lx-stroke)",
            background:
              "linear-gradient(180deg, rgba(28, 28, 30, 0.98), rgba(18, 18, 20, 0.98))",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "0 4px" }}>
            <span
              style={{
                color: "var(--lx-accent-bright)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              Setup
            </span>
            <h1
              style={{
                margin: 0,
                color: "var(--lx-fg-primary)",
                fontSize: 23,
                lineHeight: 1,
              }}
            >
              控台设置
            </h1>
            <p
              style={{
                margin: 0,
                color: "var(--lx-fg-secondary)",
                lineHeight: 1.6,
                fontSize: 12,
              }}
            >
              管理 show 文件里的配接、灯具资料和基础配置。
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
                    alignItems: "center",
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
            minHeight: 0,
            overflow: "hidden",
            padding: 18,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            gap: 14,
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
            <span className="lx-badge lx-badge-success">Local UI</span>
          </div>

          {activeSection === "patch" ? (
            <ConnectivitySettingsPage />
          ) : (
            <FixtureTypesSettingsPage />
          )}
        </main>
      </div>
    </WindowChrome>
  );
}
