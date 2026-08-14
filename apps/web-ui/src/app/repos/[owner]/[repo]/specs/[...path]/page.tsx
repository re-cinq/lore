export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchTraceDocument, fetchTraceSource } from "@/lib/trace-api";
import { toStatementInfo } from "@/lib/trace-statement-info";
import { parseSpecStatus } from "@/lib/spec-status";
import SpecStatusPill from "@/components/SpecStatusPill";
import SpecDocument from "./SpecDocument";
import styles from "./page.module.scss";

export default async function RepoSpecDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join("/");
  const specsLink = `/repos/${owner}/${repo}/specs`;

  // Graph is the source of truth: the byte-exact markdown SOURCE renders as a
  // normal document (framed per section), and the statement overlay (tested
  // underline + hover node details) comes from the structured document.
  const [source, doc] = await Promise.all([
    fetchTraceSource(fullName, filePath),
    fetchTraceDocument(fullName, filePath),
  ]);
  const statements = doc ? toStatementInfo(doc.statements) : [];
  const status = source ? parseSpecStatus(source) : null;

  return (
    <div>
      <p className={`meta ${styles.breadcrumb}`}>
        <Link href={specsLink}>← Specs</Link>
        {status && <SpecStatusPill info={status} />}
      </p>
      {source ? (
        <SpecDocument
          repo={fullName}
          content={source}
          statements={statements}
        />
      ) : (
        <p className="muted">
          No graph data for <code>{filePath}</code>. Build the graph from the{" "}
          <strong>Graph</strong> tab and run the <code>ingest-*</code> tasks,
          then refresh.
        </p>
      )}
    </div>
  );
}
