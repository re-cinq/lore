export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchTraceSource } from "@/lib/trace-api";
import { parseFrontmatter } from "@/lib/frontmatter";
import SpecDocument from "../../specs/[...path]/SpecDocument";
import AdrMetaView from "./AdrMetaView";

export default async function RepoAdrDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = path.map(decodeURIComponent).join("/");
  const adrsLink = `/repos/${owner}/${repo}/adrs`;

  // ADR source from graph (no coverage), frontmatter → metadata header (safe to strip).
  const source = await fetchTraceSource(fullName, filePath);
  const { meta, body } = parseFrontmatter(source ?? "");

  return (
    <div>
      <p className="meta page-lede">
        <Link href={adrsLink}>← ADRs</Link>
      </p>
      {source ? (
        <>
          <AdrMetaView owner={owner} repo={repo} meta={meta} />
          <SpecDocument repo={fullName} content={body} statements={[]} />
        </>
      ) : (
        <p className="muted">
          No graph data for <code>{filePath}</code>. ADRs are projected
          automatically by CI on push to <code>main</code>; refresh after the
          next ingest.
        </p>
      )}
    </div>
  );
}
