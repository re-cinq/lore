"use client";

// ADR list from graph /trace API; status filters from frontmatter (no Postgres).
import SpecCard from "../specs/SpecCard";
import DocListToolbar, { useDocListView } from "@/components/DocListToolbar";
import { filterDocCards, sortDocCards } from "@/lib/doc-filter";
import type { SpecStatusInfo } from "@/lib/spec-status";

interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
}

/** Not an error state: ADRs reach the graph through CI, so an empty list means nothing has been pushed since the workflow was installed. */
function EmptyAdrs() {
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

interface AdrListViewProps {
  owner: string;
  repo: string;
  adrs: AdrSummary[];
  /** Status per ADR path. Absent for a repo whose ADRs have not been projected yet. */
  statuses?: Record<string, SpecStatusInfo>;
}

export default function AdrListView(props: AdrListViewProps) {
  const { owner, repo, adrs, statuses = {} } = props;
  const view = useDocListView();

  if (adrs.length === 0) {
    return <EmptyAdrs />;
  }
  const statusOf = (adr: AdrSummary) => statuses[adr.filePath];
  const { counts, visible } = filterDocCards(adrs, statusOf, view.filter, {
    query: view.query,
    textOf: (adr) => `${adr.title} ${adr.description} ${adr.filePath}`,
  });
  const ordered = sortDocCards(visible, view.order, statusOf);

  return (
    <div>
      <DocListToolbar
        view={view}
        counts={counts}
        total={adrs.length}
        kind="adr"
      />
      <AdrCards adrs={ordered} statusOf={statusOf} owner={owner} repo={repo} />
      {ordered.length === 0 && (
        <p className="muted">No ADRs match this filter.</p>
      )}
    </div>
  );
}
