export const dynamic = "force-dynamic";
import Link from "next/link";
import { fetchTraceSource } from "@/lib/trace-api";
import { parseFrontmatter } from "@/lib/frontmatter";
import SpecDocument from "../../specs/[...path]/SpecDocument";
import AdrMetaView from "./AdrMetaView";
import { decodeCatchAllPath } from "@/lib/catch-all-path";

interface RepoAdrDetailProps {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
}

export default async function RepoAdrDetail({ params }: RepoAdrDetailProps) {
  const { owner, repo, path } = await params;
  const fullName = `${owner}/${repo}`;
  const filePath = decodeCatchAllPath(path);
  const { source, meta, body } = await readAdr(fullName, filePath);

  return (
    <div>
      <AdrsBreadcrumb href={`/repos/${owner}/${repo}/adrs`} />
      {source ? (
        <>
          <AdrMetaView owner={owner} repo={repo} meta={meta} />
          <SpecDocument repo={fullName} content={body} statements={[]} />
        </>
      ) : (
        <EmptyGraphData filePath={filePath} />
      )}
    </div>
  );
}

/** ADR source from the graph (no coverage overlay); its frontmatter becomes the metadata header and is stripped from the body. */
async function readAdr(fullName: string, filePath: string) {
  const source = await fetchTraceSource(fullName, filePath);
  const { meta, body } = parseFrontmatter(source ?? "");

  return { source, meta, body };
}

function AdrsBreadcrumb({ href }: { href: string }) {
  return (
    <p className="meta page-lede">
      <Link href={href}>← ADRs</Link>
    </p>
  );
}

/** Why this ADR is blank, and when it will not be. Nothing here is for the reader to do: the projection runs on the next push to `main`, so the note says to come back rather than offering an action. */
function EmptyGraphData({ filePath }: { filePath: string }) {
  return (
    <p className="muted">
      No graph data for <code>{filePath}</code>. ADRs are projected
      automatically by CI on push to <code>main</code>; refresh after the next
      ingest.
    </p>
  );
}
