import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dynamicIsland } from "@limxdesk/notifications";
import { Plus, RadioTower, RefreshCw, Save, Trash2 } from "lucide-react";

type NetworkProtocol = "artNet" | "sacn";

interface NetworkOutputTarget {
  id: string;
  label: string;
  protocol: NetworkProtocol;
  destination: string;
  port: number;
  enabled: boolean;
}

const PROTOCOL_LABELS: Record<NetworkProtocol, string> = {
  artNet: "Art-Net",
  sacn: "sACN",
};

export function NetworkSettingsPage() {
  const [targets, setTargets] = useState<NetworkOutputTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [logLine, setLogLine] = useState("Ready");

  useEffect(() => {
    void loadTargets();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const outputChanged = await listen("output:changed", () => {
        void loadTargets();
      });
      const showLoaded = await listen("show:loaded", () => {
        void loadTargets();
      });
      const showDeleted = await listen("show:deleted", () => {
        void loadTargets();
      });

      if (!active) {
        outputChanged();
        showLoaded();
        showDeleted();
        return;
      }
      unlisteners.push(outputChanged, showLoaded, showDeleted);
    };

    void register();
    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  async function loadTargets() {
    setBusy(true);
    try {
      const nextTargets = await invoke<NetworkOutputTarget[]>("output_get_targets");
      setTargets(nextTargets);
      setLogLine(`Loaded ${nextTargets.length} output target${nextTargets.length === 1 ? "" : "s"}`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveTargets() {
    setBusy(true);
    const islandId = dynamicIsland.show({
      type: "loading",
      title: "正在保存网络输出",
      subtitle: "写入当前 show 的 output.v1",
      glow: true,
    });
    try {
      const saved = await invoke<NetworkOutputTarget[]>("output_set_targets", {
        targets: normalizeTargets(targets),
      });
      setTargets(saved);
      setLogLine("Network output targets saved");
      dynamicIsland.update(islandId, {
        type: "success",
        title: "网络输出已保存",
        subtitle: `${saved.length} targets`,
        progress: 1,
        spinning: false,
        glow: false,
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 1800);
    } catch (error) {
      const message = errorToMessage(error);
      setLogLine(message);
      dynamicIsland.update(islandId, {
        type: "error",
        title: "网络输出保存失败",
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

  function updateTarget(id: string, patch: Partial<NetworkOutputTarget>) {
    setTargets((current) =>
      current.map((target) => (target.id === id ? { ...target, ...patch } : target)),
    );
  }

  function addTarget(protocol: NetworkProtocol) {
    const index = targets.length + 1;
    setTargets((current) => [
      ...current,
      {
        id: `${protocol}-${Date.now()}`,
        label: `${PROTOCOL_LABELS[protocol]} ${index}`,
        protocol,
        destination: protocol === "sacn" ? "multicast" : "255.255.255.255",
        port: protocol === "sacn" ? 5568 : 6454,
        enabled: true,
      },
    ]);
  }

  function deleteTarget(id: string) {
    setTargets((current) => current.filter((target) => target.id !== id));
  }

  return (
    <div
      style={{
        display: "grid",
        minHeight: 0,
        height: "100%",
        gridTemplateRows: "auto minmax(0, 1fr) 76px",
        gap: 10,
      }}
    >
      <div className="lx-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RadioTower size={16} style={{ color: "var(--lx-primary-bright)" }} />
          <div style={{ display: "grid", gap: 3 }}>
            <span style={{ color: "var(--lx-fg-primary)", fontSize: 13, fontWeight: 800 }}>网络输出目标</span>
            <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>{logLine}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={loadTargets} disabled={busy}>
            <RefreshCw size={13} />
            刷新
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => addTarget("artNet")} disabled={busy}>
            <Plus size={13} />
            Art-Net
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => addTarget("sacn")} disabled={busy}>
            <Plus size={13} />
            sACN
          </button>
          <button type="button" className="lx-btn lx-btn-primary" onClick={saveTargets} disabled={busy}>
            <Save size={13} />
            保存
          </button>
        </div>
      </div>

      <div className="lx-panel" style={{ minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", color: "var(--lx-fg-secondary)", fontSize: 11 }}>
          <thead>
            <tr style={{ height: 30, color: "var(--lx-fg-tertiary)", background: "var(--lx-bg-deep)", textTransform: "uppercase" }}>
              <HeaderCell width={76}>Enabled</HeaderCell>
              <HeaderCell width={120}>Protocol</HeaderCell>
              <HeaderCell>Label</HeaderCell>
              <HeaderCell width={220}>Destination</HeaderCell>
              <HeaderCell width={100}>Port</HeaderCell>
              <HeaderCell width={72}>Delete</HeaderCell>
            </tr>
          </thead>
          <tbody>
            {targets.map((target) => (
              <tr key={target.id} style={{ height: 38, borderTop: "1px solid rgba(255,255,255,0.055)" }}>
                <BodyCell>
                  <input type="checkbox" checked={target.enabled} onChange={(event) => updateTarget(target.id, { enabled: event.currentTarget.checked })} />
                </BodyCell>
                <BodyCell>
                  <select className="lx-input lx-input-sm" value={target.protocol} onChange={(event) => updateTarget(target.id, protocolDefaults(event.currentTarget.value as NetworkProtocol))}>
                    <option value="artNet">Art-Net</option>
                    <option value="sacn">sACN</option>
                  </select>
                </BodyCell>
                <BodyCell>
                  <input className="lx-input lx-input-sm" value={target.label} onChange={(event) => updateTarget(target.id, { label: event.currentTarget.value })} />
                </BodyCell>
                <BodyCell>
                  <input className="lx-input lx-input-sm" value={target.destination} onChange={(event) => updateTarget(target.id, { destination: event.currentTarget.value })} />
                </BodyCell>
                <BodyCell>
                  <input className="lx-input lx-input-sm" type="number" min={1} max={65535} value={target.port} onChange={(event) => updateTarget(target.id, { port: Number(event.currentTarget.value) })} />
                </BodyCell>
                <BodyCell>
                  <button type="button" className="lx-icon-btn" onClick={() => deleteTarget(target.id)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </BodyCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lx-panel" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: 10 }}>
        <Metric label="Targets" value={targets.length} />
        <Metric label="Enabled" value={targets.filter((target) => target.enabled).length} />
        <Metric label="Art-Net" value={targets.filter((target) => target.protocol === "artNet").length} />
        <Metric label="sACN" value={targets.filter((target) => target.protocol === "sacn").length} />
      </div>
    </div>
  );
}

function protocolDefaults(protocol: NetworkProtocol): Partial<NetworkOutputTarget> {
  return {
    protocol,
    destination: protocol === "sacn" ? "multicast" : "255.255.255.255",
    port: protocol === "sacn" ? 5568 : 6454,
  };
}

function normalizeTargets(targets: NetworkOutputTarget[]) {
  return targets.map((target, index) => ({
    ...target,
    id: target.id || `${target.protocol}-${index + 1}`,
    label: target.label.trim() || `${PROTOCOL_LABELS[target.protocol]} ${index + 1}`,
    destination: target.destination.trim() || (target.protocol === "sacn" ? "multicast" : "255.255.255.255"),
    port: Number.isFinite(target.port) && target.port > 0 ? target.port : target.protocol === "sacn" ? 5568 : 6454,
  }));
}

function HeaderCell({ children, width }: { children: ReactNode; width?: number }) {
  return <th style={{ width, padding: "0 10px", textAlign: "left", fontWeight: 800 }}>{children}</th>;
}

function BodyCell({ children }: { children: ReactNode }) {
  return <td style={{ padding: "0 10px" }}>{children}</td>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "8px 10px" }}>
      <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</div>
      <div style={{ color: "var(--lx-fg-primary)", fontSize: 20, fontWeight: 850 }}>{value}</div>
    </div>
  );
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
