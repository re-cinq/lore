"use client";

import { useState } from "react";
import DocListControls from "@/components/DocListControls";
import SpecStatusChips from "@/components/SpecStatusChips";
import type { filterDocCards, DocSortOrder } from "@/lib/doc-filter";
import type { DocKind, SpecStatusFilter } from "@/lib/spec-status";

/** What the reader has narrowed a doc list to. Defaults to every doc, ordered by path — the ordering a reader can predict before the page loads. */
export function useDocListView() {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<DocSortOrder>("path");

  return { filter, setFilter, query, setQuery, order, setOrder };
}

interface DocListToolbarProps {
  view: ReturnType<typeof useDocListView>;
  counts: ReturnType<typeof filterDocCards>["counts"];
  total: number;
  kind?: DocKind;
}

/** Search, sort and the status chips. Counts come from the FULL set rather than the visible one: selecting a status must not make the other statuses look empty. */
export default function DocListToolbar(props: DocListToolbarProps) {
  const { view, counts, total, kind } = props;

  return (
    <>
      <DocListControls
        query={view.query}
        onQueryChange={view.setQuery}
        sort={view.order}
        onSortChange={view.setOrder}
      />
      <SpecStatusChips
        counts={counts}
        total={total}
        active={view.filter}
        onChange={view.setFilter}
        kind={kind}
      />
    </>
  );
}
