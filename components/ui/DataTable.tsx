import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
};

// Generic data table. Per blueprint 16.3 ("wide tables convert to labelled
// rows" on mobile), renders as a real <table> on md+ and as stacked
// label/value cards below md, from the same data and column config.
export default function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyMessage = "Nothing to show yet.",
}: {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <>
      <table className="hidden w-full text-left text-sm md:table">
        <thead>
          <tr className="border-b border-surface-border text-xs uppercase text-ink-muted">
            {columns.map((col) => (
              <th key={col.key} className="py-3 pr-4 font-semibold">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-surface-border last:border-0">
              {columns.map((col) => (
                <td key={col.key} className="py-3 pr-4">
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-surface-border p-4">
            {columns.map((col) => (
              <div
                key={col.key}
                className="flex items-center justify-between gap-4 py-1 text-sm"
              >
                <span className="text-xs font-semibold uppercase text-ink-muted">
                  {col.header}
                </span>
                <span>{col.render(row)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
