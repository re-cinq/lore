export const dynamic = "force-dynamic";
import { fetchAdrSummaries } from "@/lib/trace-api";
import AdrListView from "./AdrListView";

export default async function RepoAdrs({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;

  // The spec-traceability graph is the source of truth — list each ADR as a card
  // summary (title/description parsed from its byte-exact source), not Postgres.
  const adrs = (await fetchAdrSummaries(`${owner}/${repo}`)).sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Architecture decision records in the traceability graph ({adrs.length}).
      </p>
      <AdrListView owner={owner} repo={repo} adrs={adrs} />
    </div>
  );
}
