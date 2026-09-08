"use client";

// Pure controlled inputs; filtering/sorting itself lives in lib/doc-filter, and the sort select renders only for lists that opt in.
import styles from "./DocListControls.module.scss";
import type { DocSortOrder } from "@/lib/doc-filter";

interface DocListControlsProps {
  query: string;
  onQueryChange: (query: string) => void;
  sort?: DocSortOrder;
  onSortChange?: (order: DocSortOrder) => void;
}

/** The sort control, shown only when the caller can act on it. A disabled or inert select would suggest an ordering the list does not actually offer. */
function SortSelect({
  sort,
  onSortChange,
}: Pick<DocListControlsProps, "sort" | "onSortChange">) {
  if (!onSortChange) {
    return null;
  }

  return (
    <select
      value={sort}
      onChange={(event) => onSortChange(event.target.value as DocSortOrder)}
      className={styles.sort}
    >
      <option value="path">Sort: path</option>
      <option value="status">Sort: status</option>
    </select>
  );
}

export default function DocListControls({
  query,
  onQueryChange,
  sort,
  onSortChange,
}: DocListControlsProps) {
  return (
    <div className={styles.controls}>
      <input
        type="search"
        value={query}
        placeholder="Search title or description…"
        onChange={(event) => onQueryChange(event.target.value)}
        className={styles.search}
      />
      <SortSelect sort={sort} onSortChange={onSortChange} />
    </div>
  );
}
