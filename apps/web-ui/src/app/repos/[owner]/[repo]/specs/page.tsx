export const dynamic = "force-dynamic";
import { fetchSpecSummaries } from "@/lib/trace-api";
import {
  fetchDocStatusesFromGraph,
  specStatusKey,
} from "@/lib/spec-status-source";
import SpecListView from "./SpecListView";

export default async function RepoSpecs({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // The spec-traceability graph is the source of truth — the list and the
  // lifecycle status pills (parsed from each spec.md's graph source) alike.
  const summaries = await fetchSpecSummaries(fullName);
  const specs = summaries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  const byRepoKey = await fetchDocStatusesFromGraph(
    specs.map((s) => ({ repo: fullName, filePath: s.filePath })),
    "spec",
  );
  const statuses = Object.fromEntries(
    specs
      .map((s) => [s.filePath, byRepoKey[specStatusKey(fullName, s.filePath)]])
      .filter(([, info]) => info),
  );

  return (
    <div>
      <p className="meta" style={{ marginBottom: 12 }}>
        Specs in the traceability graph for <code>{fullName}</code> (
        {specs.length}).
      </p>
      <SpecListView
        owner={owner}
        repo={repo}
        specs={specs}
        statuses={statuses}
      />
    </div>
  );
}
