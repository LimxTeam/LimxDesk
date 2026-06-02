import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { EncoderKnob } from "./EncoderKnob";

const PARAM_TABS = [
  { id: "dimmer",   label: "Dimmer" },
  { id: "position", label: "Position" },
  { id: "gobo",     label: "Gobo" },
  { id: "color",    label: "Color" },
  { id: "beam",     label: "Beam" },
  { id: "focus",    label: "Focus" },
];

const EXTRA_TABS = ["Selection", "Phaser", "MAttricks", "Prog Time", "Exec Time"];

const SUB_TABS = [
  { id: "values",   label: "Values and Timings" },
  { id: "overall",  label: "Phaser Overall" },
  { id: "steps",    label: "Phaser Steps" },
  { id: "absolute", label: "Absolute" },
  { id: "relative", label: "Relative" },
  { id: "fade",     label: "Fade" },
  { id: "delay",    label: "Delay" },
];

/** 各属性组对应的参数列表（模拟 MA3 属性栏） */
const PARAM_ATTRIBUTES: Record<string, { name: string; value: string }[]> = {
  dimmer:   [{ name: "Dimmer", value: "0%" }, { name: "Intensity", value: "100%" }],
  position: [{ name: "Pan", value: "135.0°" }, { name: "Tilt", value: "67.5°" }, { name: "PanFine", value: "0.0" }, { name: "TiltFine", value: "0.0" }],
  gobo:     [{ name: "Gobo1", value: "Open" }, { name: "Gobo1 Rot", value: "0°" }, { name: "Gobo2", value: "Open" }, { name: "Gobo2 Rot", value: "0°" }],
  color:    [{ name: "Color1", value: "White" }, { name: "Color2", value: "White" }, { name: "CMY", value: "0" }, { name: "CTO", value: "0" }],
  beam:     [{ name: "Iris", value: "100%" }, { name: "Shutter", value: "Open" }, { name: "Prism", value: "Out" }],
  focus:    [{ name: "Focus", value: "0%" }, { name: "Zoom", value: "50%" }, { name: "Frost", value: "0%" }],
};

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState("dimmer");
  const [activeSub, setActiveSub] = useState("values");

  const attributes = PARAM_ATTRIBUTES[activeTab] ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Row 1: 参数选项卡 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 24,
          padding: "0 6px",
          gap: 1,
          borderBottom: "1px solid var(--lx-stroke)",
          flexShrink: 0,
        }}
      >
        {PARAM_TABS.map((tab, i) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              height: 20,
              padding: "0 8px",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              borderRadius: "var(--lx-radius-xs)",
              border: "none",
              cursor: "pointer",
              background: activeTab === tab.id ? "var(--lx-accent-dim)" : "transparent",
              color: activeTab === tab.id ? "var(--lx-accent-bright)" : "var(--lx-fg-tertiary)",
            }}
          >
            {i + 1} {tab.label}
          </button>
        ))}
        {EXTRA_TABS.map((l) => (
          <button
            key={l}
            style={{
              height: 20,
              padding: "0 6px",
              fontSize: 9,
              fontWeight: 500,
              borderRadius: "var(--lx-radius-xs)",
              border: "none",
              cursor: "pointer",
              background: "transparent",
              color: "var(--lx-fg-muted)",
              marginLeft: 4,
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Row 2: 子选项卡 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 22,
          padding: "0 6px",
          gap: 1,
          borderBottom: "1px solid var(--lx-stroke)",
          flexShrink: 0,
        }}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSub(tab.id)}
            style={{
              height: 18,
              padding: "0 7px",
              fontSize: 10,
              fontWeight: 500,
              borderRadius: "var(--lx-radius-xs)",
              border: "none",
              cursor: "pointer",
              background: activeSub === tab.id ? "var(--lx-accent-dim)" : "transparent",
              color: activeSub === tab.id ? "var(--lx-accent-bright)" : "var(--lx-fg-tertiary)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Row 3: 属性参数栏 — MA3 核心区域 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 26,
          padding: "0 6px",
          gap: 3,
          borderBottom: "1px solid var(--lx-stroke)",
          flexShrink: 0,
          overflowX: "auto",
        }}
        className="lx-hide-scrollbar"
      >
        {attributes.map((attr) => (
          <button
            key={attr.name}
            style={{
              height: 20,
              padding: "0 8px",
              fontSize: 10,
              fontWeight: 500,
              borderRadius: "var(--lx-radius-xs)",
              border: "1px solid var(--lx-stroke-strong)",
              cursor: "pointer",
              background: "var(--lx-bg-deep)",
              color: "var(--lx-fg-secondary)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--lx-fg-tertiary)" }}>{attr.name}</span>
            <span style={{ fontFamily: "var(--lx-font-mono)", color: "var(--lx-primary-bright)" }}>
              {attr.value}
            </span>
          </button>
        ))}
      </div>

      {/* Row 4: 编码器 + 分辨率 + 显示选择器 + Grand Master */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          gap: 8,
        }}
      >
        {/* 编码器旋钮 */}
        <EncoderKnob label="Coars" value="0" />
        <EncoderKnob label="Fine" value="0.0" />
        <EncoderKnob label="Incr" value="1" />
        <EncoderKnob label="Nativ" value="—" />

        {/* 属性标签 + 计数 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, marginLeft: 4 }}>
          <span style={{ fontSize: 10, color: "var(--lx-fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--lx-fg-primary)", fontFamily: "var(--lx-font-mono)" }}>
            1 of 1
          </span>
        </div>

        {/* Link Resolution */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            marginLeft: 8,
            padding: "0 6px",
            height: 22,
            borderRadius: "var(--lx-radius-xs)",
            border: "1px solid var(--lx-stroke)",
            background: "var(--lx-bg-deep)",
          }}
        >
          <span style={{ fontSize: 9, color: "var(--lx-fg-muted)" }}>Link Resolution</span>
          <span style={{ fontSize: 10, color: "var(--lx-fg-secondary)", fontWeight: 600 }}>Single</span>
          <ChevronDown size={10} style={{ color: "var(--lx-fg-muted)" }} />
        </div>

        {/* 显示选择器 */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {[1, 2].map((n) => (
            <div key={n} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1px solid var(--lx-stroke-strong)",
                  background: "var(--lx-bg-deep)",
                }}
              />
              <span style={{ fontSize: 9, color: "var(--lx-fg-tertiary)" }}>
                Screen {n === 1 ? "Y" : "X"} / Display {n}
              </span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 1 }}>
            <ChevronLeft size={12} style={{ color: "var(--lx-fg-tertiary)", cursor: "pointer" }} />
            <ChevronRight size={12} style={{ color: "var(--lx-fg-tertiary)", cursor: "pointer" }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--lx-fg-secondary)", fontFamily: "var(--lx-font-mono)" }}>
            1
          </span>
        </div>

        {/* Grand Master */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 9, color: "var(--lx-fg-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Grand Master
          </span>
          <div
            style={{
              padding: "2px 10px",
              background: "var(--lx-bg-deep)",
              border: "1px solid var(--lx-stroke-strong)",
              borderRadius: "var(--lx-radius-xs)",
              fontSize: 13,
              fontWeight: 700,
              color: "var(--lx-primary-bright)",
              fontFamily: "var(--lx-font-mono)",
            }}
          >
            100%
          </div>
        </div>
      </div>
    </div>
  );
}
