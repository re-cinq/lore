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

export default function SpecListView({
  owner,
  repo,
  specs,
  statuses = {},
}: {
  owner: string;
  repo: string;
  specs: SpecSummaryInput[];
  statuses?: Record<string, SpecStatusInfo>;
}) {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<DocSortOrder>("path");

  if (specs.length === 0) {
    return (
      <p className="muted">
        No specs in the graph yet. Specs are projected automatically by CI on
        every push to <code>main</code> — push a<code>specs/</code> change (or
        re-run the <strong>lore-ingest</strong> workflow), then refresh.
      </p>
    );
  }
  const groups = groupSpecSummaries(specs);
  const statusOf = (group: { key: string; files: { filePath: string }[] }) =>
    statuses[`${group.key}/spec.md`] ?? statuses[group.files[0]?.filePath];
  const { counts, visible } = filterDocCards(groups, statusOf, filter, {
    query,
    textOf: (group) => `${group.title} ${group.description} ${group.key}`,
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
        total={groups.length}
        active={filter}
        onChange={setFilter}
      />
      {ordered.map((group) => (
        <SpecCard
          key={group.key}
          title={group.title}
          description={group.description}
          status={statusOf(group)}
          coverage={group.coverage}
          files={group.files.map((file) => ({
            label: file.filePath.startsWith(`${group.key}/`)
              ? file.filePath.slice(group.key.length + 1)
              : file.filePath,
            href: `/repos/${owner}/${repo}/specs/${encodeURIComponent(file.filePath)}`,
          }))}
        />
      ))}
      {visible.length === 0 && (
        <p className="muted">No specs match this status filter.</p>
      )}
    </div>
  );
}
