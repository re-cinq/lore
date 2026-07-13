// Presentational (data-down) list of a repo's specs, sourced from the
// spec-traceability graph via the /trace API. The per-file summaries are grouped
// into one card per spec folder (groupSpecSummaries): the card is titled from
// spec.md and links to every file in the folder. No Postgres chunk reads — the
// graph is the source of truth.
import SpecCard from "./SpecCard";
import { groupSpecSummaries, type SpecSummaryInput } from "@/lib/spec-grouping";

export default function SpecListView({
  owner,
  repo,
  specs,
}: {
  owner: string;
  repo: string;
  specs: SpecSummaryInput[];
}) {
  if (specs.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)" }}>
        No specs in the graph yet. Specs are projected automatically by CI on
        every push to <code>main</code> — push a<code>specs/</code> change (or
        re-run the <strong>lore-ingest</strong> workflow), then refresh.
      </p>
    );
  }
  const groups = groupSpecSummaries(specs);
  return (
    <div>
      {groups.map((group) => (
        <SpecCard
          key={group.key}
          title={group.title}
          description={group.description}
          coverage={group.coverage}
          files={group.files.map((file) => ({
            label: file.filePath.startsWith(`${group.key}/`)
              ? file.filePath.slice(group.key.length + 1)
              : file.filePath,
            href: `/repos/${owner}/${repo}/specs/${encodeURIComponent(file.filePath)}`,
          }))}
        />
      ))}
    </div>
  );
}
