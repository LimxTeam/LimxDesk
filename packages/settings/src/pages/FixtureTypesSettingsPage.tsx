const FIXTURE_FAMILIES = [
  { name: "Beam / Spot Hybrid", manufacturer: "Robe", mode: "56 ch", profile: "Loaded" },
  { name: "LED Wash XL", manufacturer: "Martin", mode: "32 ch", profile: "Draft" },
  { name: "Pixel Strobe Bar", manufacturer: "GLP", mode: "120 ch", profile: "Validated" },
  { name: "Followspot Remote", manufacturer: "Arri", mode: "28 ch", profile: "Loaded" },
];

const TEMPLATE_BLOCKS = [
  { title: "Attribute Schema", body: "Color wheels, additive engines, pan/tilt, beam, shutters, and virtual dimmer stacks." },
  { title: "Physical Metadata", body: "Lens angle, weight, power draw, mounting style, yoke limits, and safety offsets." },
  { title: "Visualization", body: "Emitter geometry, beam cone presets, gobos, media layers, and stage proxy meshes." },
];

export function FixtureTypesSettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section
        className="lx-panel-glow"
        style={{
          padding: 18,
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              color: "var(--lx-accent-bright)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Fixture Types
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 26,
              lineHeight: 1.05,
              color: "var(--lx-fg-primary)",
            }}
          >
            Design the fixture library like a real show-system taxonomy.
          </h2>
          <p
            style={{
              margin: 0,
              maxWidth: 680,
              color: "var(--lx-fg-secondary)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            This page is where the operator curates fixture templates, channel
            layouts, and visualization metadata. It should support both clean
            stock libraries and aggressive custom type authoring.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          {[
            { label: "Library Count", value: "148 Types" },
            { label: "Custom Types", value: "26 Edited" },
            { label: "Visual Profiles", value: "91 Synced" },
            { label: "Template Drift", value: "2 Warnings" },
          ].map((item) => (
            <div
              key={item.label}
              className="lx-panel"
              style={{
                padding: 14,
                background:
                  "linear-gradient(180deg, rgba(18, 18, 24, 0.92), rgba(10, 10, 14, 0.98))",
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
                {item.label}
              </div>
              <div style={{ color: "var(--lx-fg-primary)", fontWeight: 700, fontSize: 18 }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.12fr) minmax(320px, 0.88fr)",
          gap: 16,
        }}
      >
        <div className="lx-panel" style={{ overflow: "hidden" }}>
          <div className="lx-panel-header">
            <span>Fixture Type Library</span>
            <span style={{ fontFamily: "var(--lx-font-mono)" }}>Authoring Mode</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {FIXTURE_FAMILIES.map((row) => (
              <div
                key={`${row.name}-${row.mode}`}
                className="lx-table-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 0.8fr 0.6fr 0.6fr",
                  height: 46,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ color: "var(--lx-fg-primary)", fontWeight: 600 }}>
                    {row.name}
                  </span>
                  <span style={{ color: "var(--lx-fg-tertiary)", fontSize: 10 }}>
                    Template family / personality mapping
                  </span>
                </div>
                <span>{row.manufacturer}</span>
                <span className="lx-code">{row.mode}</span>
                <span
                  className={`lx-badge ${
                    row.profile === "Validated"
                      ? "lx-badge-success"
                      : row.profile === "Draft"
                        ? "lx-badge-warn"
                        : "lx-badge-info"
                  }`}
                >
                  {row.profile}
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
              Type Builder Blocks
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {TEMPLATE_BLOCKS.map((block) => (
                <div
                  key={block.title}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "var(--lx-radius-sm)",
                    border: "1px solid var(--lx-stroke)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div
                    style={{
                      color: "var(--lx-fg-primary)",
                      fontWeight: 700,
                      marginBottom: 6,
                    }}
                  >
                    {block.title}
                  </div>
                  <div style={{ color: "var(--lx-fg-secondary)", lineHeight: 1.5 }}>
                    {block.body}
                  </div>
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
              Validation Pipeline
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                "DMX channel map matches imported profile personality.",
                "Visualization emitters align with beam origin and lens size.",
                "Default encoder pages group attributes for operator speed.",
              ].map((item, index) => (
                <div
                  key={item}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: "var(--lx-radius-sm)",
                    background: "var(--lx-bg-deep)",
                    border: "1px solid var(--lx-stroke)",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: "50%",
                      background: index === 2 ? "var(--lx-accent-fill)" : "var(--lx-primary-dim)",
                      color: index === 2 ? "var(--lx-accent-bright)" : "var(--lx-primary-bright)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ color: "var(--lx-fg-secondary)", lineHeight: 1.5 }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
