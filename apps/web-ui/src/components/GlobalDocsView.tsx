"use client";

// `kind` is a plain string, not an href-building callback, since a client component rendered by server components cannot receive functions across that boundary.
import { useState } from "react";
import Link from "next/link";
import styles from "./GlobalDocsView.module.scss";
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

function groupByRepo(
  visible: Array<{ repo: string; filePath: string }>,
): Map<string, string[]> {
  const byRepo = new Map<string, string[]>();

  for (const { repo, filePath } of visible) {
    const bucket = byRepo.get(repo);

    if (bucket) {
      bucket.push(filePath);
      continue;
    }

    byRepo.set(repo, [filePath]);
  }

  return byRepo;
}

function RepoDocList({
  repo,
  paths,
  kind,
  statusOf,
}: {
  repo: string;
  paths: string[];
  kind: DocKind;
  statusOf: (repo: string, filePath: string) => SpecStatusInfo | undefined;
}) {
  return (
    <section className={styles.repoGroup}>
      <h2 className={styles.repoName}>{repo}</h2>
      <ul className={styles.docList}>
        {paths.map((filePath) => {
          const status = statusOf(repo, filePath);

          return (
            <li key={filePath} className={styles.docItem}>
              <Link href={hrefFor(kind, repo, filePath)}>{filePath}</Link>
              {status && <SpecStatusPill status={status} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
    return <p className={styles.hint}>{emptyHint}</p>;
  }

  const statusOf = (repo: string, filePath: string) =>
    statuses[`${repo}::${filePath}`];
  const { counts, visible } = filterDocCards(
    docs,
    (doc) => statusOf(doc.repo, doc.filePath),
    filter,
    { query, textOf: (doc) => `${doc.repo} ${doc.filePath}` },
  );

  const byRepo = groupByRepo(visible);

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
        <RepoDocList
          key={repo}
          repo={repo}
          paths={paths}
          kind={kind}
          statusOf={statusOf}
        />
      ))}
      {byRepo.size === 0 && <p className={styles.hint}>{noMatchHint}</p>}
    </div>
  );
}
