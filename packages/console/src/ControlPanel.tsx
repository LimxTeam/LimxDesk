import { useState } from "react";
import { AttributeTabBar } from "./components/AttributeTabBar";
import { ToolButtonGroup } from "./components/ToolButtonGroup";
import { BigEncoderWheel } from "./components/BigEncoderWheel";
import { ModeButtonBar } from "./components/ModeButtonBar";
import { CommandButtonPanel } from "./components/CommandButtonPanel";
import { EncoderInfoBar } from "./components/EncoderInfoBar";

/** 编码器参数定义 */
interface EncoderParam {
  name: string;
  value: string;
}

/** 各属性分类对应的翻页信息和编码器参数列表 */
const PAGE_INFO: Record<string, { name: string; page: string; encoders: EncoderParam[] }> = {
  dimmer: {
    name: "Dimmer",
    page: "1 of 1",
    encoders: [{ name: "Dim", value: "100%" }],
  },
  position: {
    name: "Position",
    page: "1 of 2",
    encoders: [
      { name: "Pan", value: "0°" },
      { name: "Tilt", value: "0°" },
    ],
  },
  gobo: {
    name: "Gobo",
    page: "1 of 2",
    encoders: [
      { name: "Gobo1", value: "Open" },
      { name: "Gobo1 Rot", value: "0°" },
    ],
  },
  color: {
    name: "Color",
    page: "1 of 4",
    encoders: [
      { name: "Color1", value: "100%" },
      { name: "Color2", value: "0%" },
      { name: "Color3", value: "0%" },
      { name: "Color4", value: "0%" },
    ],
  },
  beam: {
    name: "Beam",
    page: "1 of 3",
    encoders: [
      { name: "Iris", value: "100%" },
      { name: "Zoom", value: "50%" },
      { name: "Frost", value: "0%" },
    ],
  },
  focus: {
    name: "Focus",
    page: "1 of 2",
    encoders: [
      { name: "Focus", value: "50%" },
      { name: "Zoom", value: "50%" },
    ],
  },
  selection: {
    name: "Selection",
    page: "—",
    encoders: [{ name: "Sel", value: "" }],
  },
  phaser: {
    name: "Phaser",
    page: "—",
    encoders: [{ name: "Phase", value: "0°" }],
  },
  matricks: {
    name: "MAtricks",
    page: "—",
    encoders: [{ name: "MAT", value: "" }],
  },
  progtime: {
    name: "ProgTime",
    page: "—",
    encoders: [{ name: "Time", value: "3s" }],
  },
  exectime: {
    name: "ExecTime",
    page: "—",
    encoders: [{ name: "Time", value: "3s" }],
  },
};

export function ControlPanel() {
  const [activeTab, setActiveTab] = useState("dimmer");

  const info = PAGE_INFO[activeTab] ?? PAGE_INFO.dimmer;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Row 1: 属性分类标签栏 ── */}
      <AttributeTabBar activeId={activeTab} onChange={setActiveTab} />

      {/* ── Row 2: 主工作区 ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* 左侧：工具按钮 */}
        <ToolButtonGroup />

        {/* 中间：编码器区域（上方信息行 + 下方编码器们） */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            padding: "2px 8px",
            flexShrink: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* 上方行：翻页信息 + Link Resolution + Single/Feature + 模式按钮 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 20,
              minHeight: 20,
              flexShrink: 0,
              marginBottom: 4,
            }}
          >
            <EncoderInfoBar
              attributeName={info.name}
              page={info.page}
            />
            <ModeButtonBar />
          </div>

          {/* 编码器行：多个编码器水平排列，靠左，加内边距 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 20,
              flexShrink: 0,
              padding: "8px 12px",
            }}
          >
            {info.encoders.map((enc, i) => (
              <BigEncoderWheel
                key={`${info.name}-${i}`}
                paramName={enc.name}
                value={enc.value}
              />
            ))}
          </div>
        </div>

        {/* 右侧：命令按钮面板（占据剩余空间） */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderLeft: "1px solid var(--lx-stroke)",
            flex: 1,
            minWidth: 440,
          }}
        >
          <CommandButtonPanel
            onButtonPress={(label) => console.log("Button pressed:", label)}
          />
        </div>
      </div>
    </div>
  );
}
