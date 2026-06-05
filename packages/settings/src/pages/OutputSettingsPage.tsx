import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dynamicIsland } from "@limxdesk/notifications";
import { Activity, RadioTower, RefreshCw, Send } from "lucide-react";

interface DmxUniverseFrame {
  universe: number;
  data: number[];
  sources?: DmxChannelSource[];
}

type DmxChannelSource = "none" | "default" | "programmer";

interface OutputSendReport {
  frames: number;
  packets: number;
  bytes: number;
  sentAtMs: number;
}

interface NetworkOutputTarget {
  id: string;
  label: string;
  protocol: "artNet" | "sacn";
  mode: "outputBroadcast" | "outputUnicast" | "outputMulticast";
  localAddress: string;
  destination: string;
  port: number;
  localUniverse: number;
  amount: number;
  artnetNet: number;
  artnetSubnet: number;
  artnetUniverse: number;
  sacnUniverse: number;
  priority: number;
  ttl: number;
  delayMs: number;
  enabled: boolean;
}

export function OutputSettingsPage() {
  const [frames, setFrames] = useState<DmxUniverseFrame[]>([]);
  const [targets, setTargets] = useState<NetworkOutputTarget[]>([]);
  const [lastReport, setLastReport] = useState<OutputSendReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [logLine, setLogLine] = useState("Ready");

  const enabledTargets = targets.filter((target) => target.enabled);
  const activeChannels = useMemo(
    () => frames.reduce((sum, frame) => sum + frame.data.filter((value) => value > 0).length, 0),
    [frames],
  );

  useEffect(() => {
    void refreshOutput();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const programmerChanged = await listen("programmer:changed", () => {
        void refreshOutput(false);
      });
      const outputSent = await listen<OutputSendReport>("output:sent", (event) => {
        setLastReport(event.payload);
        setLogLine(`Sent ${event.payload.packets} packet${event.payload.packets === 1 ? "" : "s"} / ${event.payload.bytes} bytes`);
        void refreshOutput(false);
      });
      const outputChanged = await listen("output:changed", () => {
        void refreshOutput(false);
      });
      const patchChanged = await listen("patch:changed", () => {
        void refreshOutput(false);
      });
      const showLoaded = await listen("show:loaded", () => {
        void refreshOutput();
      });
      const showDeleted = await listen("show:deleted", () => {
        setFrames([]);
        setTargets([]);
        setLastReport(null);
        setLogLine("No show loaded");
      });

      if (!active) {
        programmerChanged();
        outputSent();
        outputChanged();
        patchChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(programmerChanged, outputSent, outputChanged, patchChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function refreshOutput(showBusy = true) {
    if (showBusy) setBusy(true);
    try {
      const [nextFrames, nextTargets] = await Promise.all([
        invoke<DmxUniverseFrame[]>("output_render_dmx"),
        invoke<NetworkOutputTarget[]>("output_get_targets"),
      ]);
      setFrames(nextFrames);
      setTargets(nextTargets);
      setLogLine(`Rendered ${nextFrames.length} universe${nextFrames.length === 1 ? "" : "s"}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  async function sendCurrentOutput() {
    setBusy(true);
    const islandId = dynamicIsland.show({
      type: "loading",
      title: "正在发送 DMX 输出",
      subtitle: "Programmer -> DMX -> Network",
      glow: true,
    });

    try {
      const report = await invoke<OutputSendReport>("output_send_current");
      setLastReport(report);
      setLogLine(`Sent ${report.packets} packet${report.packets === 1 ? "" : "s"} / ${report.bytes} bytes`);
      dynamicIsland.update(islandId, {
        type: report.packets > 0 ? "success" : "warning",
        title: report.packets > 0 ? "DMX 已发送" : "没有可发送的 DMX 帧",
        subtitle: `${report.frames} universes / ${report.packets} packets`,
        progress: 1,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 2200);
      await refreshOutput(false);
    } catch (error) {
      const message = errorToMessage(error);
      setLogLine(message);
      dynamicIsland.update(islandId, {
        type: "error",
        title: "DMX 发送失败",
        subtitle: message,
        progress: 0,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 4200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        minHeight: 0,
        height: "100%",
        gridTemplateRows: "auto auto minmax(0, 1fr)",
        gap: 10,
      }}
    >
      <div className="lx-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Activity size={16} style={{ color: "var(--lx-action-bright)" }} />
          <div style={{ display: "grid", gap: 3 }}>
            <span style={{ color: "var(--lx-fg-primary)", fontSize: 13, fontWeight: 800 }}>实时输出监视</span>
            <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>{logLine}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => refreshOutput()} disabled={busy}>
            <RefreshCw size={13} />
            刷新
          </button>
          <button type="button" className="lx-btn lx-btn-primary" onClick={sendCurrentOutput} disabled={busy || enabledTargets.length === 0}>
            <Send size={13} />
            发送当前输出
          </button>
        </div>
      </div>

      <div className="lx-panel" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, padding: 10 }}>
        <Metric label="Universes" value={frames.length} />
        <Metric label="Active Channels" value={activeChannels} />
        <Metric label="Targets" value={targets.length} />
        <Metric label="Enabled Targets" value={enabledTargets.length} />
        <Metric label="Packets" value={lastReport?.packets ?? 0} />
      </div>

      <div style={{ display: "grid", minHeight: 0, gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 10 }}>
        <div className="lx-panel" style={{ minHeight: 0, overflow: "auto" }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", color: "var(--lx-fg-secondary)", fontSize: 11 }}>
            <thead>
              <tr style={{ height: 30, color: "var(--lx-fg-tertiary)", background: "var(--lx-bg-deep)", textTransform: "uppercase" }}>
                <th style={{ width: 92, padding: "0 10px", textAlign: "left" }}>Universe</th>
                <th style={{ width: 120, padding: "0 10px", textAlign: "left" }}>Used</th>
                <th style={{ padding: "0 10px", textAlign: "left" }}>First Active Channels</th>
              </tr>
            </thead>
            <tbody>
              {frames.length > 0 ? (
                frames.map((frame) => {
                  const active = frame.data
                    .map((value, index) => ({
                      channel: index + 1,
                      value,
                      source: frame.sources?.[index] ?? "none",
                    }))
                    .filter((item) => item.value > 0)
                    .slice(0, 28);
                  return (
                    <tr key={frame.universe} style={{ height: 42, borderTop: "1px solid rgba(255,255,255,0.055)" }}>
                      <td className="lx-code" style={{ padding: "0 10px", color: "var(--lx-fg-primary)" }}>{frame.universe}</td>
                      <td className="lx-code" style={{ padding: "0 10px" }}>{frame.data.filter((value) => value > 0).length}/512</td>
                      <td style={{ padding: "0 10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {active.length > 0 ? (
                            active.map((item) => (
                              <span key={item.channel} className="lx-badge lx-badge-success">
                                {item.channel}:{item.value} {sourceLabel(item.source)}
                              </span>
                            ))
                          ) : (
                            <span style={{ color: "var(--lx-fg-tertiary)" }}>No active channel</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} style={{ padding: 18, textAlign: "center", color: "var(--lx-fg-tertiary)" }}>
                    没有 DMX 帧。先加载 show、配接灯具、选择灯具并转动编码器。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="lx-panel" style={{ display: "grid", alignContent: "start", gap: 8, padding: 10, minHeight: 0, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--lx-fg-primary)", fontSize: 12, fontWeight: 800 }}>
            <RadioTower size={14} />
            Active Targets
          </div>
          {targets.map((target) => (
            <div key={target.id} style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", padding: 8, background: "var(--lx-bg-deep)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ color: "var(--lx-fg-primary)", fontSize: 12, fontWeight: 800 }}>{target.label}</span>
                <span className={`lx-badge ${target.enabled ? "lx-badge-success" : "lx-badge-warn"}`}>
                  {target.enabled ? "On" : "Off"}
                </span>
              </div>
              <div className="lx-code" style={{ marginTop: 6, color: "var(--lx-fg-tertiary)" }}>
                {target.protocol} / {target.mode} / {target.localAddress}{" -> "}{targetDestinationLabel(target)}
              </div>
              <div className="lx-code" style={{ marginTop: 4, color: "var(--lx-fg-tertiary)" }}>
                Local {target.localUniverse}-{target.localUniverse + target.amount - 1} / {protocolUniverseLabel(target)} / TTL {target.ttl}
              </div>
            </div>
          ))}
          {targets.length === 0 ? (
            <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 12 }}>没有网络输出目标。</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sourceLabel(source: DmxChannelSource) {
  if (source === "programmer") return "P";
  if (source === "default") return "D";
  return "";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "8px 10px" }}>
      <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</div>
      <div style={{ color: "var(--lx-fg-primary)", fontSize: 20, fontWeight: 850 }}>{value}</div>
    </div>
  );
}

function targetDestinationLabel(target: NetworkOutputTarget) {
  if (target.protocol === "sacn" && target.mode === "outputMulticast") return `multicast:${target.port}`;
  return `${target.destination}:${target.port}`;
}

function protocolUniverseLabel(target: NetworkOutputTarget) {
  if (target.protocol === "artNet") {
    return `Net ${target.artnetNet} / Subnet ${target.artnetSubnet} / Universe ${target.artnetUniverse}`;
  }
  return `sACN ${target.sacnUniverse} / Priority ${target.priority}`;
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
