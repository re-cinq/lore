// Presentational ADR list, sourced from the spec-traceability graph via the
// /trace API. Renders one SpecCard per summary (no coverage figure — ADRs have
// none); each card links to the byte-exact ADR detail (reassembled from the
// graph's Block layer). No Postgres reads — the graph is the source of truth.
import SpecCard from '../specs/SpecCard';

interface AdrSummary {
  filePath: string;
  title: string;
  description: string;
}

export default function AdrListView({
  owner,
  repo,
  adrs,
}: {
  owner: string;
  repo: string;
  adrs: AdrSummary[];
}) {
  if (adrs.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        No ADRs in the graph yet. Build the graph from the <strong>Graph</strong> tab and run the <code>ingest-adrs</code>{' '}
        task, then refresh.
      </p>
    );
  }
  return (
    <div>
      {adrs.map(({ filePath, title, description }) => (
        <SpecCard
          key={filePath}
          title={title}
          description={description}
          detailsHref={`/repos/${owner}/${repo}/adrs/${encodeURIComponent(filePath)}`}
        />
      ))}
    </div>
  );
}
