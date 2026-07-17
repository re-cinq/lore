"use client";

// Presentational ADR list, sourced from the spec-traceability graph via the
// /trace API. Renders one SpecCard per summary (no coverage figure — ADRs have
// none); each card links to the byte-exact ADR detail (reassembled from the
// graph's Block layer). Lifecycle statuses are parsed from each ADR's
// frontmatter (fetchDocStatusesFromGraph; statuses prop, keyed by file path)
// and drive the filter chips. No Postgres reads — the graph is the source of
// truth.
import { useState } from "react";
import SpecCard from "../specs/SpecCard";
import DocListControls from "@/components/DocListControls";
import SpecStatusChips from "@/components/SpecStatusChips";
import {
  filterDocCards,
  sortDocCards,
  type DocSortOrder,
} from "@/lib/doc-filter";
import type { SpecStatusFilter, SpecStatusInfo } from "@/lib/spec-status";

interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
}

export default function AdrListView({
  owner,
  repo,
  adrs,
  statuses = {},
}: {
  owner: string;
  repo: string;
  adrs: AdrSummary[];
  statuses?: Record<string, SpecStatusInfo>;
}) {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<DocSortOrder>("path");

  if (adrs.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)" }}>
        No ADRs in the graph yet. ADRs are projected automatically by CI on
        every push to <code>main</code> — push an
        <code>adrs/</code> change (or re-run the <strong>lore-ingest</strong>{" "}
        workflow), then refresh.
      </p>
    );
  }
  const statusOf = (adr: AdrSummary) => statuses[adr.filePath];
  const { counts, visible } = filterDocCards(
    adrs,
    statusOf,
    filter,
    query,
    (adr) => `${adr.title} ${adr.description} ${adr.filePath}`,
  );
  const ordered = sortDocCards(visible, order, statusOf);

  return (
    <div>
      <DocListControls
        query={query}
        onQueryChange={setQuery}
        sort={order}
        onSortChange={setOrder}
      />
      <SpecStatusChips
        counts={counts}
        total={adrs.length}
        active={filter}
        onChange={setFilter}
        kind="adr"
      />
      {ordered.map((adr) => (
        <SpecCard
          key={adr.filePath}
          title={adr.title}
          description={adr.description}
          status={statusOf(adr)}
          detailsHref={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(adr.filePath)}`}
        />
      ))}
      {ordered.length === 0 && (
        <p style={{ color: "var(--text-muted)" }}>No ADRs match this filter.</p>
      )}
    </div>
  );
}
