"use client";

// Spec list from /trace API: cards grouped by folder, statuses from graph (source of truth).
import SpecCard from "./SpecCard";
import DocListToolbar, { useDocListView } from "@/components/DocListToolbar";
import {
  filterDocCards,
  sortDocCards,
  type DocSortOrder,
} from "@/lib/doc-filter";
import { groupSpecSummaries, type SpecSummaryInput } from "@/lib/spec-grouping";
import { type SpecStatusFilter, type SpecStatusInfo } from "@/lib/spec-status";

interface SpecListViewProps {
  owner: string;
  repo: string;
  specs: SpecSummaryInput[];
  statuses?: Record<string, SpecStatusInfo>;
}

export default function SpecListView(props: SpecListViewProps) {
  const { owner, repo, specs, statuses = {} } = props;
  const view = useDocListView();

  // No specs at all and none MATCHING are different answers: the first says the repo has none, the second that this filter is too narrow.
  if (specs.length === 0) {
    return <EmptySpecs />;
  }

  return (
    <SpecListBody
      view={view}
      base={`/repos/${owner}/${repo}`}
      model={visibleSpecs(specs, statuses, view)}
    />
  );
}

/** Not an error state: specs reach the graph through CI, so an empty list means nothing has been pushed since the workflow was installed. */
function EmptySpecs() {
  return (
    <p className="muted">
      No specs in the graph yet. Specs are projected automatically by CI on
      every push to <code>main</code> — push a<code>specs/</code> change (or
      re-run the <strong>lore-ingest</strong> workflow), then refresh.
    </p>
  );
}

function visibleSpecs(
  specs: SpecSummaryInput[],
  statuses: Record<string, SpecStatusInfo>,
  view: { filter: SpecStatusFilter; query: string; order: DocSortOrder },
) {
  const groups = groupSpecSummaries(specs);
  const statusOf = groupStatusOf(statuses);
  const { counts, visible } = filterDocCards(groups, statusOf, view.filter, {
    query: view.query,
    textOf: (group) => `${group.title} ${group.description} ${group.key}`,
  });

  return {
    counts,
    ordered: sortDocCards(visible, view.order, statusOf),
    statusOf,
    groupCount: groups.length,
  };
}

/** A spec's status is read from its `spec.md` where there is one, falling back to whatever file the group leads with — a folder of fragments still has a status, it just is not on a file with that name. */
function groupStatusOf(statuses: Record<string, SpecStatusInfo>) {
  return (group: { key: string; files: { filePath: string }[] }) => {
    const { files } = group;

    return statuses[`${group.key}/spec.md`] ?? statuses[files[0]?.filePath];
  };
}

interface SpecListBodyProps {
  view: ReturnType<typeof useDocListView>;
  base: string;
  model: ReturnType<typeof visibleSpecs>;
}

/** The filtered, ordered list. Counts come from the FULL set, so picking a status does not make the other statuses look empty. */
function SpecListBody({ view, base, model }: SpecListBodyProps) {
  const { counts, ordered, statusOf, groupCount } = model;

  return (
    <div>
      <DocListToolbar view={view} counts={counts} total={groupCount} />
      <SpecCards groups={ordered} statusOf={statusOf} base={base} />
      {ordered.length === 0 && <EmptySpecFilter />}
    </div>
  );
}

interface SpecCardsProps {
  groups: ReturnType<typeof visibleSpecs>["ordered"];
  statusOf: ReturnType<typeof visibleSpecs>["statusOf"];
  base: string;
}

function SpecCards({ groups, statusOf, base }: SpecCardsProps) {
  return (
    <>
      {groups.map((group) => (
        <SpecGroupCard
          key={group.key}
          group={group}
          status={statusOf(group)}
          base={base}
        />
      ))}
    </>
  );
}

interface SpecGroupCardProps {
  group: ReturnType<typeof groupSpecSummaries>[number];
  status: SpecStatusInfo | undefined;
  /** Repo route the file links hang off, e.g. `/repos/owner/repo`. */
  base: string;
}

/** One spec folder. Each file's label drops the folder prefix, so a group of fragments reads as its parts rather than repeating the path. */
function SpecGroupCard({ group, status, base }: SpecGroupCardProps) {
  return (
    <SpecCard
      title={group.title}
      description={group.description}
      status={status}
      coverage={group.coverage}
      files={group.files.map((file) => ({
        label: file.filePath.startsWith(`${group.key}/`)
          ? file.filePath.slice(group.key.length + 1)
          : file.filePath,
        href: `${base}/specs/${encodeURIComponent(file.filePath)}`,
      }))}
    />
  );
}

/** The status filter narrowed the list to nothing, which is a different answer from the repo having no specs at all. */
function EmptySpecFilter() {
  return <p className="muted">No specs match this status filter.</p>;
}
