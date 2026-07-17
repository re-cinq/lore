export const dynamic = "force-dynamic";
import { fetchAdrSummaries } from "@/lib/trace-api";
import {
  fetchDocStatusesFromGraph,
  specStatusKey,
} from "@/lib/spec-status-source";
import AdrListView from "./AdrListView";

export default async function RepoAdrs({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // The spec-traceability graph is the source of truth — list each ADR as a card
  // summary (title/description parsed from its byte-exact source), not Postgres.
  // Lifecycle statuses come from each ADR's frontmatter via the same source.
  const adrs = (await fetchAdrSummaries(fullName)).sort((a, b) =>
    a.filePath.localeCompare(b.filePath),
  );
  const byRepoKey = await fetchDocStatusesFromGraph(
    adrs.map((a) => ({ repo: fullName, filePath: a.filePath })),
    "adr",
  );
  const statuses = Object.fromEntries(
    adrs
      .map((a) => [a.filePath, byRepoKey[specStatusKey(fullName, a.filePath)]])
      .filter(([, info]) => info),
  );

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Architecture decision records in the traceability graph ({adrs.length}).
      </p>
      <AdrListView owner={owner} repo={repo} adrs={adrs} statuses={statuses} />
    </div>
  );
}
