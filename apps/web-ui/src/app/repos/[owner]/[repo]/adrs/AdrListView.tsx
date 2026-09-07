"use client";

// ADR list from graph /trace API; status filters from frontmatter (no Postgres).
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

/** Not an error state: ADRs reach the graph through CI, so an empty list means nothing has been pushed since the workflow was installed. */
function NoAdrsYet() {
  return (
    <p className="muted">
      No ADRs in the graph yet. ADRs are projected automatically by CI on every
      push to <code>main</code> — push an<code>adrs/</code> change (or re-run
      the <strong>lore-ingest</strong> workflow), then refresh.
    </p>
  );
}

function AdrCards({
  adrs,
  statusOf,
  owner,
  repo,
}: {
  adrs: AdrSummary[];
  statusOf: (adr: AdrSummary) => SpecStatusInfo | undefined;
  owner: string;
  repo: string;
}) {
  return (
    <>
      {adrs.map((adr) => (
        <SpecCard
          key={adr.filePath}
          title={adr.title}
          description={adr.description}
          status={statusOf(adr)}
          detailsHref={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(adr.filePath)}`}
        />
      ))}
    </>
  );
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
    return <NoAdrsYet />;
  }
  const statusOf = (adr: AdrSummary) => statuses[adr.filePath];
  const { counts, visible } = filterDocCards(adrs, statusOf, filter, {
    query,
    textOf: (adr) => `${adr.title} ${adr.description} ${adr.filePath}`,
  });
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
      <AdrCards adrs={ordered} statusOf={statusOf} owner={owner} repo={repo} />
      {ordered.length === 0 && (
        <p className="muted">No ADRs match this filter.</p>
      )}
    </div>
  );
}
