"use client";

// Presentational (data-down) list of a repo's specs, sourced from the
// spec-traceability graph via the /trace API. The per-file summaries are grouped
// into one card per spec folder (groupSpecSummaries): the card is titled from
// spec.md and links to every file in the folder. Lifecycle statuses are parsed
// from the graph's byte-exact spec.md sources (fetchSpecStatusesFromGraph;
// statuses prop, keyed by file path) and drive the filter chips — the graph is
// the source of truth for list and statuses alike.
import { useState } from "react";
import SpecCard from "./SpecCard";
import SpecStatusChips from "@/components/SpecStatusChips";
import { groupSpecSummaries, type SpecSummaryInput } from "@/lib/spec-grouping";
import {
  matchesSpecStatusFilter,
  type SpecStatus,
  type SpecStatusFilter,
  type SpecStatusInfo,
} from "@/lib/spec-status";

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

  if (specs.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)" }}>
        No specs in the graph yet. Specs are projected automatically by CI on
        every push to <code>main</code> — push a<code>specs/</code> change (or
        re-run the <strong>lore-ingest</strong> workflow), then refresh.
      </p>
    );
  }
  const groups = groupSpecSummaries(specs);
  const statusOf = (group: { key: string; files: { filePath: string }[] }) =>
    statuses[`${group.key}/spec.md`] ?? statuses[group.files[0]?.filePath];
  const counts: Partial<Record<SpecStatus, number>> = {};

  for (const group of groups) {
    const info = statusOf(group);

    if (info) {
      counts[info.status] = (counts[info.status] ?? 0) + 1;
    }
  }
  const visible = groups.filter((g) =>
    matchesSpecStatusFilter(statusOf(g), filter),
  );

  return (
    <div>
      <SpecStatusChips
        counts={counts}
        total={groups.length}
        active={filter}
        onChange={setFilter}
      />
      {visible.map((group) => (
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
        <p style={{ color: "var(--text-muted)" }}>
          No specs match this status filter.
        </p>
      )}
    </div>
  );
}
