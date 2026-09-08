export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchTraceDocument, fetchTraceSource } from "@/lib/trace-api";
import { toStatementInfo } from "@/lib/trace-statement-info";
import { parseSpecStatus } from "@/lib/spec-status";
import SpecStatusPill from "@/components/SpecStatusPill";
import SpecDocument from "./SpecDocument";
import styles from "./page.module.scss";
import { decodeCatchAllPath } from "@/lib/catch-all-path";

/** The spec as the GRAPH holds it, not as the repo does: the source renders the markdown, and the document supplies the per-statement coverage overlay laid over it. */
async function readSpec(fullName: string, filePath: string) {
  const [source, doc] = await Promise.all([
    fetchTraceSource(fullName, filePath),
    fetchTraceDocument(fullName, filePath),
  ]);

  return {
    source,
    statements: doc ? toStatementInfo(doc.statements) : [],
    status: source ? parseSpecStatus(source) : null,
  };
}

/** Why this spec is blank, and how to fix it. Almost always means the graph has not been projected yet rather than that the file is missing, so the note names the steps rather than reporting a 404. */
function EmptyGraphData({ filePath }: { filePath: string }) {
  return (
    <p className="muted">
      No graph data for <code>{filePath}</code>. Build the graph from the{" "}
      <strong>Graph</strong> tab and run the <code>ingest-*</code> tasks, then
      refresh.
    </p>
  );
}

export default async function RepoSpecDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = decodeCatchAllPath(path);
  const specsLink = `/repos/${owner}/${repo}/specs`;

  const { source, statements, status } = await readSpec(fullName, filePath);

  return (
    <div>
      <p className={`meta ${styles.breadcrumb}`}>
        <Link href={specsLink}>← Specs</Link>
        {status && <SpecStatusPill status={status} />}
      </p>
      {source ? (
        <SpecDocument
          repo={fullName}
          content={source}
          statements={statements}
        />
      ) : (
        <EmptyGraphData filePath={filePath} />
      )}
    </div>
  );
}
