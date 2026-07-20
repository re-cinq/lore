"use client";

// Presentational cross-repo doc list shared by the global /specs and /adrs
// viewers, sourced from the spec-traceability graph. Groups by repo; `kind`
// picks both the detail-page href and the chip legend. It is a plain string
// rather than an href-building callback on purpose: this is a client component
// rendered by server components, and functions cannot cross that boundary.
// The lifecycle status pill per path comes from the statuses prop (keyed
// `repo::filePath`, parsed from the graph's byte-exact sources) and drives the
// filter chips — the graph is the source of truth for list and statuses alike.
import { useState } from "react";
import Link from "next/link";
import DocListControls from "@/components/DocListControls";
import SpecStatusChips from "@/components/SpecStatusChips";
import SpecStatusPill from "@/components/SpecStatusPill";
import { filterDocCards } from "@/lib/doc-filter";
import type {
  DocKind,
  SpecStatusFilter,
  SpecStatusInfo,
} from "@/lib/spec-status";

const hrefFor = (kind: DocKind, repo: string, filePath: string): string =>
  `/repos/${repo}/${kind === "adr" ? "adrs" : "specs"}/${encodeURIComponent(filePath)}`;

export default function GlobalDocsView({
  docs,
  statuses = {},
  emptyHint,
  noMatchHint,
  kind = "spec",
}: {
  docs: Array<{ repo: string; filePath: string }>;
  statuses?: Record<string, SpecStatusInfo>;
  emptyHint: string;
  noMatchHint: string;
  kind?: DocKind;
}) {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");

  if (docs.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>{emptyHint}</p>;
  }

  const statusOf = (repo: string, filePath: string) =>
    statuses[`${repo}::${filePath}`];
  const { counts, visible } = filterDocCards(
    docs,
    (doc) => statusOf(doc.repo, doc.filePath),
    filter,
    query,
    (doc) => `${doc.repo} ${doc.filePath}`,
  );

  const byRepo = new Map<string, string[]>();

  for (const { repo, filePath } of visible) {
    const bucket = byRepo.get(repo) ?? [];

    if (!byRepo.has(repo)) {
      byRepo.set(repo, bucket);
    }
    bucket.push(filePath);
  }

  return (
    <div>
      <DocListControls query={query} onQueryChange={setQuery} />
      <SpecStatusChips
        counts={counts}
        total={docs.length}
        active={filter}
        onChange={setFilter}
        kind={kind}
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
                  <Link href={hrefFor(kind, repo, filePath)}>{filePath}</Link>
                  {info && <SpecStatusPill info={info} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {byRepo.size === 0 && (
        <p style={{ color: "var(--text-muted)" }}>{noMatchHint}</p>
      )}
    </div>
  );
}
