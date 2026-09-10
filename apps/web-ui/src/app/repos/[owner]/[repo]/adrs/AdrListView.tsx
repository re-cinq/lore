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

type AdrStatusOf = (adr: AdrSummary) => SpecStatusInfo | undefined;

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

  return (
    <AdrListBody
      view={view}
      adrs={adrs}
      statusOf={(adr) => statuses[adr.filePath]}
      base={`/repos/${owner}/${repo}`}
    />
  );
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

interface AdrListBodyProps {
  view: ReturnType<typeof useDocListView>;
  adrs: AdrSummary[];
  statusOf: AdrStatusOf;
  base: string;
}

/** The filtered, ordered list. Counts come from the FULL set, so picking a status does not make the other statuses look empty. */
function AdrListBody({ view, adrs, statusOf, base }: AdrListBodyProps) {
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
      <AdrCards adrs={ordered} statusOf={statusOf} base={base} />
      {ordered.length === 0 && <EmptyAdrFilter />}
    </div>
  );
}

interface AdrCardsProps {
  adrs: AdrSummary[];
  statusOf: AdrStatusOf;
  /** Repo route the detail links hang off, e.g. `/repos/owner/repo`. */
  base: string;
}

function AdrCards({ adrs, statusOf, base }: AdrCardsProps) {
  return (
    <>
      {adrs.map((adr) => (
        <SpecCard
          key={adr.filePath}
          title={adr.title}
          description={adr.description}
          status={statusOf(adr)}
          detailsHref={`${base}/adrs/${encodeURIComponent(adr.filePath)}`}
        />
      ))}
    </>
  );
}

/** The filter narrowed the list to nothing, which is a different answer from the repo having no ADRs at all. */
function EmptyAdrFilter() {
  return <p className="muted">No ADRs match this filter.</p>;
}
