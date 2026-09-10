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

type StatusOf = (repo: string, filePath: string) => SpecStatusInfo | undefined;

const hrefFor = (kind: DocKind, repo: string, filePath: string): string =>
  `/repos/${repo}/${kind === "adr" ? "adrs" : "specs"}/${encodeURIComponent(filePath)}`;

interface GlobalDocsViewProps {
  docs: Array<{ repo: string; filePath: string }>;
  statuses?: Record<string, SpecStatusInfo>;
  emptyHint: string;
  noMatchHint: string;
  kind?: DocKind;
}

export default function GlobalDocsView(props: GlobalDocsViewProps) {
  const [filter, setFilter] = useState<SpecStatusFilter>("all");
  const [query, setQuery] = useState("");

  // Nothing at all and nothing MATCHING are different answers: the first means the org has no specs yet, the second that this filter is too narrow.
  if (props.docs.length === 0) {
    return <p className={styles.hint}>{props.emptyHint}</p>;
  }

  return (
    <div>
      <DocListControls query={query} onQueryChange={setQuery} />
      <DocSections
        view={props}
        filter={filter}
        query={query}
        onChange={setFilter}
      />
    </div>
  );
}

interface DocSectionsProps {
  view: GlobalDocsViewProps;
  filter: SpecStatusFilter;
  query: string;
  onChange: (filter: SpecStatusFilter) => void;
}

/** The chips and the lists, both driven by the same filtered pass over the docs. */
function DocSections({ view, filter, query, onChange }: DocSectionsProps) {
  const { docs, statuses = {}, kind = "spec" } = view;
  const statusOf: StatusOf = (repo, filePath) =>
    statuses[`${repo}::${filePath}`];
  const { counts, byRepo } = visibleDocs(docs, statusOf, { filter, query });
  const chips = { counts, total: docs.length, active: filter, onChange, kind };
  const lists = { byRepo, kind, statusOf, noMatchHint: view.noMatchHint };

  return (
    <>
      <SpecStatusChips {...chips} />
      <RepoDocLists {...lists} />
    </>
  );
}

interface RepoDocListsProps {
  byRepo: Map<string, string[]>;
  kind: DocKind;
  statusOf: StatusOf;
  noMatchHint: string;
}

/** One list per repo holding a matching doc, or the no-match hint. Grouped by repo rather than flat because a path alone (`specs/spec.md`) does not say which repo it belongs to, and several repos use the same names. */
function RepoDocLists({
  byRepo,
  kind,
  statusOf,
  noMatchHint,
}: RepoDocListsProps) {
  if (byRepo.size === 0) {
    return <p className={styles.hint}>{noMatchHint}</p>;
  }

  return [...byRepo.entries()].map(([repo, paths]) => (
    <RepoDocList
      key={repo}
      repo={repo}
      paths={paths}
      kind={kind}
      statusOf={statusOf}
    />
  ));
}

interface RepoDocListProps {
  repo: string;
  paths: string[];
  kind: DocKind;
  statusOf: StatusOf;
}

function RepoDocList({ repo, paths, kind, statusOf }: RepoDocListProps) {
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

/** The docs this filter and query admit, grouped by repo. Counts come from the FULL set, not the visible one — the status chips have to keep reporting how many of each there are, or selecting one would make the others look empty. */
function visibleDocs(
  docs: GlobalDocsViewProps["docs"],
  statusOf: StatusOf,
  { filter, query }: { filter: SpecStatusFilter; query: string },
) {
  const { counts, visible } = filterDocCards(
    docs,
    (doc) => statusOf(doc.repo, doc.filePath),
    filter,
    { query, textOf: (doc) => `${doc.repo} ${doc.filePath}` },
  );

  return { counts, byRepo: groupByRepo(visible) };
}

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
