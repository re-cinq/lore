export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchTraceDocument, fetchTraceSource } from "@/lib/trace-api";
import { toStatementInfo } from "@/lib/trace-statement-info";
import { parseSpecStatus, type SpecStatusInfo } from "@/lib/spec-status";
import SpecStatusPill from "@/components/SpecStatusPill";
import SpecDocument from "./SpecDocument";
import type { StatementInfo } from "../SpecDetails";
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

interface SpecBreadcrumbProps {
  href: string;
  status: SpecStatusInfo | null;
}

function SpecBreadcrumb({ href, status }: SpecBreadcrumbProps) {
  return (
    <p className={`meta ${styles.breadcrumb}`}>
      <Link href={href}>← Specs</Link>
      {status && <SpecStatusPill status={status} />}
    </p>
  );
}

interface SpecBodyProps {
  repo: string;
  source: string | null;
  statements: StatementInfo[];
  filePath: string;
}

function SpecBody({ repo, source, statements, filePath }: SpecBodyProps) {
  if (!source) {
    return <EmptyGraphData filePath={filePath} />;
  }

  return <SpecDocument repo={repo} content={source} statements={statements} />;
}

interface RepoSpecDetailProps {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}

export default async function RepoSpecDetail({ params }: RepoSpecDetailProps) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = decodeCatchAllPath(path);
  const { source, statements, status } = await readSpec(fullName, filePath);

  return (
    <div>
      <SpecBreadcrumb href={`/repos/${owner}/${repo}/specs`} status={status} />
      <SpecBody
        repo={fullName}
        source={source}
        statements={statements}
        filePath={filePath}
      />
    </div>
  );
}
