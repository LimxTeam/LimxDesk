import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dynamicIsland } from "@limxdesk/notifications";
import { Plus, RadioTower, RefreshCw, Save, Trash2 } from "lucide-react";

type NetworkProtocol = "artNet" | "sacn";
type NetworkOutputMode = "outputBroadcast" | "outputUnicast" | "outputMulticast";

interface NetworkInterfaceInfo {
  id: string;
  name: string;
  address: string;
  netmask: string;
  broadcast: string | null;
  loopback: boolean;
}

interface NetworkOutputTarget {
  id: string;
  label: string;
  protocol: NetworkProtocol;
  mode: NetworkOutputMode;
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

const PROTOCOL_LABELS: Record<NetworkProtocol, string> = {
  artNet: "Art-Net",
  sacn: "sACN",
};

const MODE_LABELS: Record<NetworkOutputMode, string> = {
  outputBroadcast: "OutputBroadcast",
  outputUnicast: "OutputUnicast",
  outputMulticast: "OutputMulticast",
};

export function NetworkSettingsPage() {
  const [targets, setTargets] = useState<NetworkOutputTarget[]>([]);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [activeProtocol, setActiveProtocol] = useState<NetworkProtocol>("artNet");
  const [busy, setBusy] = useState(false);
  const [logLine, setLogLine] = useState("Ready");

  const validation = useMemo(() => validateTargets(targets), [targets]);
  const enabledTargets = targets.filter((target) => target.enabled);
  const activeTargets = targets.filter((target) => target.protocol === activeProtocol);
  const activeValidation = useMemo(() => validateTargets(activeTargets), [activeTargets]);

  useEffect(() => {
    void loadNetworkState();
  }, []);

  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const register = async () => {
      const outputChanged = await listen("output:changed", () => {
        void loadNetworkState(false);
      });
      const showLoaded = await listen("show:loaded", () => {
        void loadNetworkState();
      });
      const showDeleted = await listen("show:deleted", () => {
        void loadNetworkState();
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

  async function loadNetworkState(showBusy = true) {
    if (showBusy) setBusy(true);
    try {
      const [nextTargets, nextInterfaces] = await Promise.all([
        invoke<NetworkOutputTarget[]>("output_get_targets"),
        invoke<NetworkInterfaceInfo[]>("output_network_interfaces"),
      ]);
      setTargets(nextTargets.map(completeTarget));
      setInterfaces(nextInterfaces);
      setLogLine(`Loaded ${nextTargets.length} targets / ${nextInterfaces.length} local IPv4 sources`);
    } catch (error) {
      setLogLine(errorToMessage(error));
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  async function saveTargets() {
    const errors = validateTargets(targets);
    if (errors.length > 0) {
      setLogLine(errors[0]);
      const islandId = dynamicIsland.show({
        type: "error",
        title: "网络输出配置无效",
        subtitle: errors[0],
      });
      window.setTimeout(() => dynamicIsland.hide(islandId), 3600);
      return;
    }

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
      setTargets(saved.map(completeTarget));
      setLogLine("Network output configuration saved");
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
      current.map((target) => (target.id === id ? completeTarget({ ...target, ...patch }) : target)),
    );
  }

  function addTarget(protocol: NetworkProtocol, mode: NetworkOutputMode) {
    const index = targets.length + 1;
    setActiveProtocol(protocol);
    setTargets((current) => [
      ...current,
      createTarget(protocol, mode, index, preferredLocalAddress(interfaces)),
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
        gridTemplateRows: "auto auto minmax(0, 1fr) 116px",
        gap: 10,
      }}
    >
      <div className="lx-panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <RadioTower size={16} style={{ color: "var(--lx-primary-bright)" }} />
          <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <span style={{ color: "var(--lx-fg-primary)", fontSize: 13, fontWeight: 800 }}>网络协议输出</span>
            <span className="lx-code" style={{ color: validation.length > 0 ? "var(--lx-danger)" : "var(--lx-fg-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {validation[0] ?? logLine}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => loadNetworkState()} disabled={busy}>
            <RefreshCw size={13} />
            刷新
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => addTarget("artNet", "outputBroadcast")} disabled={busy}>
            <Plus size={13} />
            Art-Net 广播
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => addTarget("artNet", "outputUnicast")} disabled={busy}>
            <Plus size={13} />
            Art-Net 单播
          </button>
          <button type="button" className="lx-btn lx-btn-ghost" onClick={() => addTarget("sacn", "outputMulticast")} disabled={busy}>
            <Plus size={13} />
            sACN 组播
          </button>
          <button type="button" className="lx-btn lx-btn-primary" onClick={saveTargets} disabled={busy || validation.length > 0}>
            <Save size={13} />
            保存
          </button>
        </div>
      </div>

      <div className="lx-panel" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", padding: 4, gap: 4 }}>
        <ProtocolTab
          active={activeProtocol === "artNet"}
          label="Art-Net"
          count={targets.filter((target) => target.protocol === "artNet").length}
          enabled={targets.filter((target) => target.protocol === "artNet" && target.enabled).length}
          invalid={targets.filter((target) => target.protocol === "artNet" && validateTarget(target)).length}
          onClick={() => setActiveProtocol("artNet")}
        />
        <ProtocolTab
          active={activeProtocol === "sacn"}
          label="sACN"
          count={targets.filter((target) => target.protocol === "sacn").length}
          enabled={targets.filter((target) => target.protocol === "sacn" && target.enabled).length}
          invalid={targets.filter((target) => target.protocol === "sacn" && validateTarget(target)).length}
          onClick={() => setActiveProtocol("sacn")}
        />
      </div>

      <div className="lx-panel" style={{ minHeight: 0, overflow: "auto" }}>
        {activeProtocol === "artNet" ? (
          <ArtNetTable
            targets={activeTargets}
            interfaces={interfaces}
            updateTarget={updateTarget}
            deleteTarget={deleteTarget}
          />
        ) : (
          <SacnTable
            targets={activeTargets}
            interfaces={interfaces}
            updateTarget={updateTarget}
            deleteTarget={deleteTarget}
          />
        )}
      </div>

      <div className="lx-panel" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) minmax(260px, 1.4fr)", gap: 8, padding: 10, minHeight: 0 }}>
        <Metric label={`${PROTOCOL_LABELS[activeProtocol]} Targets`} value={activeTargets.length} />
        <Metric label="Enabled" value={activeTargets.filter((target) => target.enabled).length} />
        <Metric label="Invalid" value={activeValidation.length} />
        <Metric label="All Enabled" value={enabledTargets.length} />
        <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "8px 10px", overflow: "auto" }}>
          <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9, marginBottom: 7 }}>Local IPv4 Sources</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {interfaces.map((item) => (
              <span key={item.id} className={item.address === "0.0.0.0" ? "lx-badge lx-badge-success" : "lx-badge"}>
                {item.address}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function createTarget(protocol: NetworkProtocol, mode: NetworkOutputMode, index: number, localAddress: string): NetworkOutputTarget {
  return completeTarget({
    id: `${protocol}-${mode}-${Date.now()}-${index}`,
    label: `${PROTOCOL_LABELS[protocol]} ${index}`,
    protocol,
    mode,
    localAddress,
    destination: defaultDestination(protocol, mode),
    port: protocol === "sacn" ? 5568 : 6454,
    localUniverse: 1,
    amount: protocol === "sacn" ? 8 : 256,
    artnetNet: 0,
    artnetSubnet: 0,
    artnetUniverse: 0,
    sacnUniverse: 1,
    priority: 100,
    ttl: 8,
    delayMs: 0,
    enabled: true,
  });
}

function ProtocolTab({ active, label, count, enabled, invalid, onClick }: { active: boolean; label: string; count: number; enabled: number; invalid: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 46,
        padding: "8px 12px",
        borderRadius: "var(--lx-radius-sm)",
        border: active ? "1px solid var(--lx-primary-trace)" : "1px solid transparent",
        background: active ? "rgba(0, 120, 212, 0.15)" : "var(--lx-bg-deep)",
        color: active ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
      }}
    >
      <span style={{ display: "grid", gap: 3, textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 850 }}>{label}</span>
        <span className="lx-code" style={{ color: "var(--lx-fg-tertiary)" }}>
          {count} targets / {enabled} enabled
        </span>
      </span>
      <span className={`lx-badge ${invalid > 0 ? "lx-badge-warn" : "lx-badge-success"}`}>
        {invalid > 0 ? `${invalid} invalid` : "valid"}
      </span>
    </button>
  );
}

function ArtNetTable({
  targets,
  interfaces,
  updateTarget,
  deleteTarget,
}: {
  targets: NetworkOutputTarget[];
  interfaces: NetworkInterfaceInfo[];
  updateTarget: (id: string, patch: Partial<NetworkOutputTarget>) => void;
  deleteTarget: (id: string) => void;
}) {
  return (
    <table style={{ width: "100%", minWidth: 1220, borderCollapse: "collapse", color: "var(--lx-fg-secondary)", fontSize: 11 }}>
      <thead>
        <tr style={{ height: 30, color: "var(--lx-fg-tertiary)", background: "var(--lx-bg-deep)", textTransform: "uppercase" }}>
          <HeaderCell width={64}>Valid</HeaderCell>
          <HeaderCell width={88}>Requested</HeaderCell>
          <HeaderCell width={160}>Mode</HeaderCell>
          <HeaderCell width={250}>Local Host</HeaderCell>
          <HeaderCell width={180}>Destination IP</HeaderCell>
          <HeaderCell width={86}>LocalSt</HeaderCell>
          <HeaderCell width={82}>Amount</HeaderCell>
          <HeaderCell width={76}>Net</HeaderCell>
          <HeaderCell width={76}>Subnet</HeaderCell>
          <HeaderCell width={84}>Universe</HeaderCell>
          <HeaderCell width={90}>Delay</HeaderCell>
          <HeaderCell width={84}>Port</HeaderCell>
          <HeaderCell width={72}>Delete</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {targets.length > 0 ? (
          targets.map((target) => {
            const rowError = validateTarget(target);
            return (
              <tr key={target.id} style={rowStyle(rowError)}>
                <ValidityCell rowError={rowError} />
                <BodyCell>
                  <input type="checkbox" checked={target.enabled} onChange={(event) => updateTarget(target.id, { enabled: event.currentTarget.checked })} />
                </BodyCell>
                <BodyCell>
                  <select className="lx-input lx-input-sm" value={target.mode} onChange={(event) => updateTarget(target.id, modeDefaults("artNet", event.currentTarget.value as NetworkOutputMode))}>
                    {allowedModes("artNet").map((mode) => (
                      <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </BodyCell>
                <LocalInterfaceCell target={target} interfaces={interfaces} updateTarget={updateTarget} />
                <BodyCell>
                  <input
                    className="lx-input lx-input-sm"
                    value={target.destination}
                    onChange={(event) => updateTarget(target.id, { destination: event.currentTarget.value })}
                  />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.localUniverse} min={1} max={63999} onChange={(value) => updateTarget(target.id, { localUniverse: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.amount} min={1} max={256} onChange={(value) => updateTarget(target.id, { amount: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.artnetNet} min={0} max={127} onChange={(value) => updateTarget(target.id, { artnetNet: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.artnetSubnet} min={0} max={15} onChange={(value) => updateTarget(target.id, { artnetSubnet: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.artnetUniverse} min={0} max={15} onChange={(value) => updateTarget(target.id, { artnetUniverse: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.delayMs} min={0} max={10000} step={0.1} onChange={(value) => updateTarget(target.id, { delayMs: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.port} min={1} max={65535} onChange={(value) => updateTarget(target.id, { port: value })} />
                </BodyCell>
                <DeleteCell id={target.id} deleteTarget={deleteTarget} />
              </tr>
            );
          })
        ) : (
          <EmptyRow colSpan={13} label="没有 Art-Net 输出目标。" />
        )}
      </tbody>
    </table>
  );
}

function SacnTable({
  targets,
  interfaces,
  updateTarget,
  deleteTarget,
}: {
  targets: NetworkOutputTarget[];
  interfaces: NetworkInterfaceInfo[];
  updateTarget: (id: string, patch: Partial<NetworkOutputTarget>) => void;
  deleteTarget: (id: string) => void;
}) {
  return (
    <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse", color: "var(--lx-fg-secondary)", fontSize: 11 }}>
      <thead>
        <tr style={{ height: 30, color: "var(--lx-fg-tertiary)", background: "var(--lx-bg-deep)", textTransform: "uppercase" }}>
          <HeaderCell width={64}>Valid</HeaderCell>
          <HeaderCell width={88}>Requested</HeaderCell>
          <HeaderCell width={160}>Mode</HeaderCell>
          <HeaderCell width={250}>Local Host</HeaderCell>
          <HeaderCell width={180}>Destination IP</HeaderCell>
          <HeaderCell width={86}>LocalSt</HeaderCell>
          <HeaderCell width={82}>Amount</HeaderCell>
          <HeaderCell width={96}>sACN Univ</HeaderCell>
          <HeaderCell width={84}>Priority</HeaderCell>
          <HeaderCell width={72}>TTL</HeaderCell>
          <HeaderCell width={90}>Delay</HeaderCell>
          <HeaderCell width={84}>Port</HeaderCell>
          <HeaderCell width={72}>Delete</HeaderCell>
        </tr>
      </thead>
      <tbody>
        {targets.length > 0 ? (
          targets.map((target) => {
            const rowError = validateTarget(target);
            return (
              <tr key={target.id} style={rowStyle(rowError)}>
                <ValidityCell rowError={rowError} />
                <BodyCell>
                  <input type="checkbox" checked={target.enabled} onChange={(event) => updateTarget(target.id, { enabled: event.currentTarget.checked })} />
                </BodyCell>
                <BodyCell>
                  <select className="lx-input lx-input-sm" value={target.mode} onChange={(event) => updateTarget(target.id, modeDefaults("sacn", event.currentTarget.value as NetworkOutputMode))}>
                    {allowedModes("sacn").map((mode) => (
                      <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </BodyCell>
                <LocalInterfaceCell target={target} interfaces={interfaces} updateTarget={updateTarget} />
                <BodyCell>
                  <input
                    className="lx-input lx-input-sm"
                    value={target.destination}
                    disabled={target.mode === "outputMulticast"}
                    onChange={(event) => updateTarget(target.id, { destination: event.currentTarget.value })}
                  />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.localUniverse} min={1} max={63999} onChange={(value) => updateTarget(target.id, { localUniverse: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.amount} min={1} max={512} onChange={(value) => updateTarget(target.id, { amount: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.sacnUniverse} min={1} max={63999} onChange={(value) => updateTarget(target.id, { sacnUniverse: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.priority} min={0} max={200} onChange={(value) => updateTarget(target.id, { priority: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.ttl} min={1} max={255} onChange={(value) => updateTarget(target.id, { ttl: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.delayMs} min={0} max={10000} step={0.1} onChange={(value) => updateTarget(target.id, { delayMs: value })} />
                </BodyCell>
                <BodyCell>
                  <NumberInput value={target.port} min={1} max={65535} onChange={(value) => updateTarget(target.id, { port: value })} />
                </BodyCell>
                <DeleteCell id={target.id} deleteTarget={deleteTarget} />
              </tr>
            );
          })
        ) : (
          <EmptyRow colSpan={13} label="没有 sACN 输出目标。" />
        )}
      </tbody>
    </table>
  );
}

function completeTarget(target: NetworkOutputTarget): NetworkOutputTarget {
  const protocol = target.protocol ?? "artNet";
  const mode = normalizeMode(protocol, target.mode);
  return {
    ...target,
    protocol,
    mode,
    localAddress: target.localAddress || "0.0.0.0",
    destination: target.destination || defaultDestination(protocol, mode),
    port: clampNumber(target.port || (protocol === "sacn" ? 5568 : 6454), 1, 65535),
    localUniverse: clampNumber(target.localUniverse || 1, 1, 63999),
    amount: clampNumber(target.amount || (protocol === "sacn" ? 8 : 256), 1, protocol === "artNet" ? 256 : 512),
    artnetNet: clampNumber(target.artnetNet ?? 0, 0, 127),
    artnetSubnet: clampNumber(target.artnetSubnet ?? 0, 0, 15),
    artnetUniverse: clampNumber(target.artnetUniverse ?? 0, 0, 15),
    sacnUniverse: clampNumber(target.sacnUniverse || 1, 1, 63999),
    priority: clampNumber(target.priority ?? 100, 0, 200),
    ttl: clampNumber(target.ttl || 8, 1, 255),
    delayMs: clampNumber(target.delayMs || 0, 0, 10000),
    enabled: Boolean(target.enabled),
  };
}

function modeDefaults(protocol: NetworkProtocol, mode: NetworkOutputMode): Partial<NetworkOutputTarget> {
  const normalized = normalizeMode(protocol, mode);
  return {
    mode: normalized,
    destination: defaultDestination(protocol, normalized),
  };
}

function normalizeTargets(targets: NetworkOutputTarget[]) {
  return targets.map((target, index) => {
    const complete = completeTarget(target);
    return {
      ...complete,
      id: complete.id || `${complete.protocol}-${index + 1}`,
      label: complete.label.trim() || `${PROTOCOL_LABELS[complete.protocol]} ${index + 1}`,
      destination: complete.destination.trim(),
    };
  });
}

function validateTargets(targets: NetworkOutputTarget[]) {
  return targets.map(validateTarget).filter((message): message is string => Boolean(message));
}

function validateTarget(target: NetworkOutputTarget) {
  if (!target.enabled) return null;
  if (!isIpv4(target.localAddress)) return `${target.label}: Local Host 不是有效 IPv4`;
  if (target.mode === "outputUnicast" && !isIpv4(target.destination)) return `${target.label}: Destination IP 不是有效 IPv4`;
  if (target.protocol === "artNet" && target.mode === "outputBroadcast" && !isIpv4(target.destination)) return `${target.label}: Art-Net Broadcast 目标地址无效`;
  if (target.protocol === "artNet") {
    const start = target.artnetNet * 256 + target.artnetSubnet * 16 + target.artnetUniverse;
    if (start + target.amount > 32768) return `${target.label}: Art-Net Universe 范围超过 15-bit Port-Address`;
  }
  if (target.protocol === "sacn" && target.sacnUniverse + target.amount - 1 > 63999) return `${target.label}: sACN Universe 范围超过 63999`;
  return null;
}

function allowedModes(protocol: NetworkProtocol): NetworkOutputMode[] {
  return protocol === "artNet"
    ? ["outputBroadcast", "outputUnicast"]
    : ["outputMulticast", "outputUnicast"];
}

function normalizeMode(protocol: NetworkProtocol, mode: NetworkOutputMode): NetworkOutputMode {
  return allowedModes(protocol).includes(mode) ? mode : protocol === "sacn" ? "outputMulticast" : "outputBroadcast";
}

function defaultDestination(protocol: NetworkProtocol, mode: NetworkOutputMode) {
  if (protocol === "sacn" && mode === "outputMulticast") return "multicast";
  if (protocol === "artNet" && mode === "outputBroadcast") return "255.255.255.255";
  return "";
}

function preferredLocalAddress(interfaces: NetworkInterfaceInfo[]) {
  return interfaces.find((item) => item.address === "0.0.0.0")?.address ?? interfaces[0]?.address ?? "0.0.0.0";
}

function isIpv4(value: string) {
  const parts = value.trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function HeaderCell({ children, width }: { children: ReactNode; width?: number }) {
  return <th style={{ width, padding: "0 10px", textAlign: "left", fontWeight: 800 }}>{children}</th>;
}

function BodyCell({ children }: { children: ReactNode }) {
  return <td style={{ padding: "0 10px" }}>{children}</td>;
}

function ValidityCell({ rowError }: { rowError: string | null }) {
  return (
    <BodyCell>
      <span className={`lx-badge ${rowError ? "lx-badge-warn" : "lx-badge-success"}`}>{rowError ? "No" : "Yes"}</span>
    </BodyCell>
  );
}

function LocalInterfaceCell({
  target,
  interfaces,
  updateTarget,
}: {
  target: NetworkOutputTarget;
  interfaces: NetworkInterfaceInfo[];
  updateTarget: (id: string, patch: Partial<NetworkOutputTarget>) => void;
}) {
  return (
    <BodyCell>
      <select className="lx-input lx-input-sm" value={target.localAddress} onChange={(event) => updateTarget(target.id, { localAddress: event.currentTarget.value })}>
        {interfaces.map((item) => (
          <option key={item.id} value={item.address}>
            {item.address} - {item.name}
          </option>
        ))}
      </select>
    </BodyCell>
  );
}

function DeleteCell({ id, deleteTarget }: { id: string; deleteTarget: (id: string) => void }) {
  return (
    <BodyCell>
      <button type="button" className="lx-icon-btn" onClick={() => deleteTarget(id)} title="Delete">
        <Trash2 size={13} />
      </button>
    </BodyCell>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: 18, textAlign: "center", color: "var(--lx-fg-tertiary)" }}>
        {label}
      </td>
    </tr>
  );
}

function NumberInput({ value, min, max, step = 1, disabled, onChange }: { value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <input
      className="lx-input lx-input-sm"
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(clampNumber(Number(event.currentTarget.value), min, max))}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--lx-stroke)", borderRadius: "var(--lx-radius-sm)", background: "var(--lx-bg-deep)", padding: "8px 10px" }}>
      <div style={{ color: "var(--lx-fg-tertiary)", fontSize: 9 }}>{label}</div>
      <div style={{ color: "var(--lx-fg-primary)", fontSize: 20, fontWeight: 850 }}>{value}</div>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function rowStyle(rowError: string | null) {
  return {
    height: 42,
    borderTop: "1px solid rgba(255,255,255,0.055)",
    background: rowError ? "rgba(255, 65, 86, 0.08)" : "transparent",
  };
}

function errorToMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
