export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  fetchAllSpecs,
  fetchTraceDocument,
  fetchTraceSource,
} from "@/lib/trace-api";
import { toStatementInfo } from "@/lib/trace-statement-info";
import SpecDocument from "@/app/repos/[owner]/[repo]/specs/[...path]/SpecDocument";
import styles from "./page.module.scss";
import { decodeCatchAllPath } from "@/lib/catch-all-path";

/** Every repo that holds this path, with its own text and statements. The same spec path can exist in several repos, and a repo whose source will not load is DROPPED rather than rendered empty — an empty frame reads as a spec with no content. */
async function fetchSpecAcrossRepos(filePath: string) {
  // Query graph: repos holding this spec path, render each as framed document
  const repos = (await fetchAllSpecs())
    .filter((s) => s.filePath === filePath)
    .map((s) => s.repo);
  const docs = (
    await Promise.all(
      repos.map(async (repo) => {
        const [source, doc] = await Promise.all([
          fetchTraceSource(repo, filePath),
          fetchTraceDocument(repo, filePath),
        ]);

        return {
          repo,
          source,
          statements: doc ? toStatementInfo(doc.statements) : [],
        };
      }),
    )
  ).filter(
    (
      entry,
    ): entry is {
      repo: string;
      source: string;
      statements: ReturnType<typeof toStatementInfo>;
    } => !!entry.source,
  );

  return docs;
}

/** Why this spec is blank, and when it will not be. Nothing here is for the reader to do: the projection runs on the next push to `main`, so the note says to come back rather than offering an action. */
function EmptyGraphData({ filePath }: { filePath: string }) {
  return (
    <div className="empty-state">
      <p>
        No graph data for &quot;{filePath}&quot;. Specs are projected
        automatically by CI on push to <code>main</code>.
      </p>
    </div>
  );
}

/** One repo's copy of the path. Usually there is exactly one — this page spans every repo holding the path, and the "view in repo" link is what takes the reader to that repo's canonical page. */
function RepoSpecBlock({
  doc,
  filePath,
}: {
  doc: Awaited<ReturnType<typeof fetchSpecAcrossRepos>>[number];
  filePath: string;
}) {
  return (
    <div className={styles.repoBlock}>
      <p className="meta">
        repo: {doc.repo} ·{" "}
        <Link href={`/repos/${doc.repo}/specs/${encodeURIComponent(filePath)}`}>
          view in repo →
        </Link>
      </p>
      <SpecDocument
        repo={doc.repo}
        content={doc.source}
        statements={doc.statements}
      />
    </div>
  );
}

export default async function SpecDetailPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = decodeCatchAllPath(path);

  const docs = await fetchSpecAcrossRepos(filePath);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/specs">Specs</Link> / {filePath}
      </div>
      {docs.length === 0 ? (
        <EmptyGraphData filePath={filePath} />
      ) : (
        docs.map((doc) => (
          <RepoSpecBlock key={doc.repo} doc={doc} filePath={filePath} />
        ))
      )}
    </div>
  );
}
