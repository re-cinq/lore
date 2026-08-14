"use client";

// Search + sort controls shared by every doc card list (specs, ADRs, the
// global browsers). Pure controlled inputs — filtering/sorting itself lives in
// lib/doc-filter; the sort select renders only for lists that opt in.
import styles from "./DocListControls.module.scss";
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
    <div className={styles.controls}>
      <input
        type="search"
        value={query}
        placeholder="Search title or description…"
        onChange={(event) => onQueryChange(event.target.value)}
        className={styles.search}
      />
      {onSortChange && (
        <select
          value={sort}
          onChange={(event) => onSortChange(event.target.value as DocSortOrder)}
          className={styles.sort}
        >
          <option value="path">Sort: path</option>
          <option value="status">Sort: status</option>
        </select>
      )}
    </div>
  );
}
