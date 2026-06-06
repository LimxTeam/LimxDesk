import { useState, useRef, type KeyboardEvent } from "react";
import { Keyboard, Globe, Mail, Network, Play } from "lucide-react";
import {
  cancelCommandStep,
  commandLineText,
  submitCommandText,
  useCommandRuntimeSnapshot,
} from "./command/commandRuntime";

export function CommandBar() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commandState = useCommandRuntimeSnapshot();
  const currentCommandLine = commandLineText(commandState);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && value.trim()) {
      void submitCommandText(value.trim());
      setValue("");
      return;
    }

    if (e.key === "Escape") {
      cancelCommandStep();
      setValue("");
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        padding: "0 8px",
        gap: 6,
      }}
    >
      {/* 模式指示 */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--lx-primary-bright)",
          letterSpacing: "0.1em",
          marginRight: 4,
          flexShrink: 0,
        }}
      >
        {commandState.mode === "idle" ? "DESK" : commandState.mode.toUpperCase()}
      </span>

      {/* 命令输入区 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          height: 24,
          padding: "0 8px",
          background: "var(--lx-bg-surface)",
          border: "1px solid var(--lx-stroke-strong)",
          borderRadius: "var(--lx-radius-xs)",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {!value && currentCommandLine !== "Ready" ? (
          <span
            className="lx-code"
            style={{
              color: "var(--lx-accent-bright)",
              fontSize: 11,
              marginRight: 8,
              whiteSpace: "nowrap",
            }}
          >
            {currentCommandLine}
          </span>
        ) : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={commandState.status || "输入命令…"}
          spellCheck={false}
          style={{
            width: "100%",
            height: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--lx-fg-primary)",
            fontFamily: "var(--lx-font-mono)",
            fontSize: 11,
            padding: 0,
          }}
        />
      </div>

      {/* 右侧工具图标 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {[Keyboard, Globe, Mail, Network, Play].map((Icon, i) => (
          <button
            key={i}
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--lx-radius-xs)",
              background: "transparent",
              border: "none",
              color: "var(--lx-fg-tertiary)",
              cursor: "pointer",
            }}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}
