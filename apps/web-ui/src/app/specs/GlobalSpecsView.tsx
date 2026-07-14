"use client";

// Presentational cross-repo spec list, sourced from the spec-traceability graph
// (/api/trace/specs). Groups by repo; each path links to that repo's structured
// graph detail. The lifecycle status pill per path is parsed from the graph's
// byte-exact spec.md sources (fetchSpecStatusesFromGraph; statuses prop, keyed
// `repo::filePath`) and drives the filter chips — the graph is the source of
// truth for list and statuses alike.
import { useState } from "react";
import Link from "next/link";
import SpecStatusChips from "@/components/SpecStatusChips";
import SpecStatusPill from "@/components/SpecStatusPill";
import {
  matchesSpecStatusFilter,
  type SpecStatus,
  type SpecStatusFilter,
  type SpecStatusInfo,
} from "@/lib/spec-status";

export default function GlobalSpecsView({
  specs,
  statuses = {},
}: {
  specs: Array<{ repo: string; filePath: string }>;
  statuses?: Record<string, SpecStatusInfo>;
}) {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");

  if (specs.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)" }}>
        No specs in the graph yet. Specs are projected automatically by CI on
        push to <code>main</code>.
      </p>
    );
  }

  const statusOf = (repo: string, filePath: string) =>
    statuses[`${repo}::${filePath}`];
  const counts: Partial<Record<SpecStatus, number>> = {};

  for (const { repo, filePath } of specs) {
    const info = statusOf(repo, filePath);

    if (info) {
      counts[info.status] = (counts[info.status] ?? 0) + 1;
    }
  }

  const byRepo = new Map<string, string[]>();

  for (const { repo, filePath } of specs) {
    if (!matchesSpecStatusFilter(statusOf(repo, filePath), filter)) {
      continue;
    }
    const bucket = byRepo.get(repo) ?? [];

    if (!byRepo.has(repo)) {
      byRepo.set(repo, bucket);
    }
    bucket.push(filePath);
  }

  return (
    <div>
      <SpecStatusChips
        counts={counts}
        total={specs.length}
        active={filter}
        onChange={setFilter}
      />
      {[...byRepo.entries()].map(([repo, paths]) => (
        <section key={repo} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: "var(--fs-base)" }}>{repo}</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {paths.map((filePath) => {
              const info = statusOf(repo, filePath);

              return (
                <li
                  key={filePath}
                  style={{
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Link
                    href={`/repos/${repo}/specs/${encodeURIComponent(filePath)}`}
                  >
                    {filePath}
                  </Link>
                  {info && <SpecStatusPill info={info} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {byRepo.size === 0 && (
        <p style={{ color: "var(--text-muted)" }}>
          No specs match this status filter.
        </p>
      )}
    </div>
  );
}
