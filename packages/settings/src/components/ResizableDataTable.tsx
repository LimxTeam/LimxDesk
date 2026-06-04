import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  id: string;
  label: string;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  render: (row: T) => ReactNode;
}

export interface ResizableDataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  selectedId?: string;
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function ResizableDataTable<T>({
  columns,
  rows,
  selectedId,
  getRowId,
  onRowClick,
}: ResizableDataTableProps<T>) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((column) => [column.id, column.width])),
  );

  const gridTemplateColumns = useMemo(
    () => columns.map((column) => `${widths[column.id] ?? column.width}px`).join(" "),
    [columns, widths],
  );
  const tableWidth = useMemo(
    () => columns.reduce((sum, column) => sum + (widths[column.id] ?? column.width), 0),
    [columns, widths],
  );

  const startResize = (column: DataTableColumn<T>, pageX: number) => {
    const startWidth = widths[column.id] ?? column.width;
    const minWidth = column.minWidth ?? 56;
    const maxWidth = column.maxWidth ?? 480;

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + event.pageX - pageX));
      setWidths((current) => ({ ...current, [column.id]: nextWidth }));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div className="lx-panel" style={{ minHeight: 0, overflow: "hidden" }}>
      <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
        <div style={{ minWidth: tableWidth }}>
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              display: "grid",
              gridTemplateColumns,
              height: 34,
              alignItems: "center",
              borderBottom: "1px solid rgba(240,157,28,0.35)",
              background: "rgba(0,0,0,0.92)",
              color: "var(--lx-fg-secondary)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {columns.map((column) => (
              <div
                key={column.id}
                style={{
                  position: "relative",
                  minWidth: 0,
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 10px",
                  borderRight: "1px solid var(--lx-stroke)",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{column.label}</span>
                <span
                  aria-hidden
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startResize(column, event.pageX);
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    right: -3,
                    bottom: 0,
                    width: 7,
                    cursor: "col-resize",
                    zIndex: 4,
                  }}
                />
              </div>
            ))}
          </div>

          {rows.map((row) => {
            const rowId = getRowId(row);
            const selected = rowId === selectedId;

            return (
              <button
                key={rowId}
                type="button"
                onClick={() => onRowClick?.(row)}
                className="lx-table-row"
                style={{
                  display: "grid",
                  width: tableWidth,
                  gridTemplateColumns,
                  height: 38,
                  alignItems: "center",
                  border: "none",
                  borderBottom: "1px solid var(--lx-stroke)",
                  background: selected ? "rgba(0,120,212,0.16)" : "transparent",
                  color: selected ? "var(--lx-fg-primary)" : "var(--lx-fg-secondary)",
                  textAlign: "left",
                }}
              >
                {columns.map((column) => (
                  <div
                    key={column.id}
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      padding: "0 10px",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={String(column.render(row) ?? "")}
                  >
                    {column.render(row)}
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
