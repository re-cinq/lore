export const dynamic = "force-dynamic";
import Link from "next/link";
import {
  fetchAllSpecs,
  fetchTraceDocument,
  fetchTraceSource,
} from "@/lib/trace-api";
import { toStatementInfo } from "@/lib/trace-statement-info";
import SpecDocument from "@/app/repos/[owner]/[repo]/specs/[...path]/SpecDocument";

export default async function SpecDetailPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");

  // Which repos hold this spec path in the graph, then render each as a framed
  // document (markdown source + graph-sourced statement overlay).
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

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/specs">Specifications</Link> / {filePath}
      </div>
      {docs.length === 0 ? (
        <div className="empty-state">
          <p>
            No graph data for &quot;{filePath}&quot;. Specs are projected
            automatically by CI on push to <code>main</code>.
          </p>
        </div>
      ) : (
        docs.map(({ repo, source, statements }) => (
          <div key={repo} style={{ marginBottom: 24 }}>
            <p className="meta">
              repo: {repo} ·{" "}
              <Link
                href={`/repos/${repo}/specs/${encodeURIComponent(filePath)}`}
              >
                view in repo →
              </Link>
            </p>
            <SpecDocument
              repo={repo}
              content={source}
              statements={statements}
            />
          </div>
        ))
      )}
    </div>
  );
}
