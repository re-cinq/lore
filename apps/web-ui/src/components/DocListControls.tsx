"use client";

// Search + sort controls shared by every doc card list (specs, ADRs, the
// global browsers). Pure controlled inputs — filtering/sorting itself lives in
// lib/doc-filter; the sort select renders only for lists that opt in.
import type { DocSortOrder } from "@/lib/doc-filter";

export default function DocListControls({
  query,
  onQueryChange,
  sort,
  onSortChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  sort?: DocSortOrder;
  onSortChange?: (order: DocSortOrder) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 12,
      }}
    >
      <input
        type="search"
        value={query}
        placeholder="Search title or description…"
        onChange={(event) => onQueryChange(event.target.value)}
        style={{
          flex: "1 1 220px",
          maxWidth: 360,
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 10px",
          background: "var(--bg-surface)",
          color: "var(--text)",
        }}
      />
      {onSortChange && (
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as DocSortOrder)}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "4px 8px",
            background: "var(--bg-surface)",
            color: "var(--text)",
          }}
        >
          <option value="path">Sort: path</option>
          <option value="status">Sort: status</option>
        </select>
      )}
    </div>
  );
}
