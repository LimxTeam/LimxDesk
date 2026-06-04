const CONNECTOR_ROWS = [
  { name: "Art-Net", port: "6454", mode: "Broadcast", universe: "1-16", status: "Online" },
  { name: "sACN", port: "5568", mode: "Multicast", universe: "17-48", status: "Standby" },
  { name: "MIDI Show", port: "DIN / USB", mode: "Input", universe: "Transport", status: "Mapped" },
];

const NETWORK_PANELS = [
  { title: "Primary Node", value: "192.168.50.24", note: "FOH Control VLAN" },
  { title: "Backup Node", value: "192.168.50.25", note: "Hot standby mirror" },
  { title: "Session Clock", value: "PTP Locked", note: "0.2 ms drift" },
];

export function ConnectivitySettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section
        className="lx-panel-glow"
        style={{
          padding: 18,
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              color: "var(--lx-primary-bright)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Connectivity
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.05,
              color: "var(--lx-fg-primary)",
            }}
          >
            Configure network, protocol, and transport surfaces.
          </h2>
          <p
            style={{
              margin: 0,
              maxWidth: 620,
              color: "var(--lx-fg-secondary)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            This page is the operational hub for adapters, session transports,
            and lighting protocol bridges. It should feel like a serious show
            machine, not a generic preferences form.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          {NETWORK_PANELS.map((panel) => (
            <div
              key={panel.title}
              className="lx-panel"
              style={{
                padding: 14,
                background:
                  "linear-gradient(180deg, rgba(17, 21, 29, 0.92), rgba(10, 12, 18, 0.96))",
              }}
            >
              <div
                style={{
                  color: "var(--lx-fg-tertiary)",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {panel.title}
              </div>
              <div
                style={{
                  color: "var(--lx-fg-primary)",
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {panel.value}
              </div>
              <div style={{ color: "var(--lx-fg-secondary)", fontSize: 11 }}>
                {panel.note}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(280px, 0.9fr)",
          gap: 16,
        }}
      >
        <div className="lx-panel" style={{ overflow: "hidden" }}>
          <div className="lx-panel-header">
            <span>Protocol Adapters</span>
            <span style={{ fontFamily: "var(--lx-font-mono)" }}>3 Active</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {CONNECTOR_ROWS.map((row) => (
              <div
                key={row.name}
                className="lx-table-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 0.7fr 0.8fr 0.8fr 0.7fr",
                  height: 42,
                  alignItems: "center",
                }}
              >
                <span style={{ color: "var(--lx-fg-primary)", fontWeight: 600 }}>
                  {row.name}
                </span>
                <span className="lx-code">{row.port}</span>
                <span>{row.mode}</span>
                <span>{row.universe}</span>
                <span
                  className={`lx-badge ${
                    row.status === "Online"
                      ? "lx-badge-success"
                      : row.status === "Standby"
                        ? "lx-badge-warn"
                        : "lx-badge-info"
                  }`}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="lx-panel" style={{ padding: 16 }}>
            <div
              style={{
                color: "var(--lx-fg-primary)",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              Adapter Policy
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                "Primary output prefers multicast unless VLAN isolation fails.",
                "Backup node mirrors universes 1-48 with 1-frame delay tolerance.",
                "Input adapters can override playback only when armed.",
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--lx-radius-sm)",
                    border: "1px solid var(--lx-stroke)",
                    background: "rgba(255,255,255,0.02)",
                    color: "var(--lx-fg-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="lx-panel" style={{ padding: 16 }}>
            <div
              style={{
                color: "var(--lx-fg-primary)",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              Live Health
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { label: "Packet Stability", value: "99.92%", tone: "var(--lx-action-bright)" },
                { label: "Frame Sync", value: "0.8 ms", tone: "var(--lx-primary-bright)" },
                { label: "Universe Failover", value: "Ready", tone: "var(--lx-accent-bright)" },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: "var(--lx-radius-sm)",
                    background: "var(--lx-bg-deep)",
                    border: "1px solid var(--lx-stroke)",
                  }}
                >
                  <span style={{ color: "var(--lx-fg-secondary)" }}>{item.label}</span>
                  <span style={{ color: item.tone, fontWeight: 700 }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
