"use client";

// Spec list from /trace API: cards grouped by folder, statuses from graph (source of truth).
import { useState } from "react";
import SpecCard from "./SpecCard";
import DocListControls from "@/components/DocListControls";
import SpecStatusChips from "@/components/SpecStatusChips";
import {
  filterDocCards,
  sortDocCards,
  type DocSortOrder,
} from "@/lib/doc-filter";
import { groupSpecSummaries, type SpecSummaryInput } from "@/lib/spec-grouping";
import { type SpecStatusFilter, type SpecStatusInfo } from "@/lib/spec-status";

/** A spec's status is read from its `spec.md` where there is one, falling back to whatever file the group leads with — a folder of fragments still has a status, it just is not on a file with that name. */
function visibleSpecs(
  specs: SpecSummaryInput[],
  statuses: Record<string, SpecStatusInfo>,
  view: { filter: SpecStatusFilter; query: string; order: DocSortOrder },
) {
  const groups = groupSpecSummaries(specs);
  const statusOf = (group: { key: string; files: { filePath: string }[] }) => {
    const { files } = group;

    return statuses[`${group.key}/spec.md`] ?? statuses[files[0]?.filePath];
  };
  const { counts, visible } = filterDocCards(groups, statusOf, view.filter, {
    query: view.query,
    textOf: (group) => `${group.title} ${group.description} ${group.key}`,
  });

  return {
    counts,
    visible,
    ordered: sortDocCards(visible, view.order, statusOf),
    statusOf,
    groupCount: groups.length,
  };
}

/** One spec folder. Each file's label drops the folder prefix, so a group of fragments reads as its parts rather than repeating the path. */
function SpecGroupCard({
  group,
  status,
  owner,
  repo,
}: {
  group: ReturnType<typeof groupSpecSummaries>[number];
  status: SpecStatusInfo | undefined;
  owner: string;
  repo: string;
}) {
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
        href: `/repos/${owner}/${repo}/specs/${encodeURIComponent(file.filePath)}`,
      }))}
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

function SpecCards({
  groups,
  statusOf,
  owner,
  repo,
}: {
  groups: ReturnType<typeof visibleSpecs>["ordered"];
  statusOf: ReturnType<typeof visibleSpecs>["statusOf"];
  owner: string;
  repo: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <SpecGroupCard
          key={group.key}
          group={group}
          status={statusOf(group)}
          owner={owner}
          repo={repo}
        />
      ))}
    </>
  );
}

interface SpecListViewProps {
  owner: string;
  repo: string;
  specs: SpecSummaryInput[];
  statuses?: Record<string, SpecStatusInfo>;
}

/** What the reader has narrowed the list to. Defaults to every spec, ordered by path — the ordering a reader can predict before the page loads. */
function useSpecListView() {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<DocSortOrder>("path");

  return { filter, setFilter, query, setQuery, order, setOrder };
}

/** Search, sort and the status chips. Counts come from the FULL set rather than the visible one: selecting a status must not make the other statuses look empty. */
function ListControls({
  view,
  counts,
  groupCount,
}: {
  view: ReturnType<typeof useSpecListView>;
  counts: ReturnType<typeof visibleSpecs>["counts"];
  groupCount: number;
}) {
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
        total={groupCount}
        active={view.filter}
        onChange={view.setFilter}
      />
    </>
  );
}

export default function SpecListView({
  owner,
  repo,
  specs,
  statuses = {},
}: SpecListViewProps) {
  const view = useSpecListView();

  // No specs at all and none MATCHING are different answers: the first says the repo has none, the second that this filter is too narrow.
  if (specs.length === 0) {
    return <EmptySpecs />;
  }
  const { counts, visible, ordered, statusOf, groupCount } = visibleSpecs(
    specs,
    statuses,
    view,
  );

  return (
    <div>
      <ListControls view={view} counts={counts} groupCount={groupCount} />
      <SpecCards
        groups={ordered}
        statusOf={statusOf}
        owner={owner}
        repo={repo}
      />
      {visible.length === 0 ? (
        <p className="muted">No specs match this status filter.</p>
      ) : null}
    </div>
  );
}
