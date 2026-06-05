import { useState, useRef, type KeyboardEvent } from "react";
import { Keyboard, Globe, Mail, Network, Play } from "lucide-react";
import { appendCommandToken, clearCommandEntry, useCommandRuntimeSnapshot } from "./command/commandRuntime";

export function CommandBar() {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commandState = useCommandRuntimeSnapshot();

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && value.trim()) {
      appendCommandToken(value.trim());
      setValue("");
      return;
    }

    if (e.key === "Escape") {
      clearCommandEntry();
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
        <input
          ref={inputRef}
          value={value || commandLinePreview(commandState.tokens)}
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

function commandLinePreview(tokens: string[]) {
  return tokens.length > 0 ? tokens.join(" ") : "";
}
