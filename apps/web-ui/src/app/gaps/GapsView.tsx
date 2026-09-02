import { Alert } from "@/components/Alert";
import { TimeAgo } from "@/components/TimeAgo";
import styles from "./GapsView.module.css";

export interface ZeroResultSearchRow {
  memory_key: string;
  metadata: Record<string, string>;
  created_at: string;
}

export interface GapMemoryRow {
  key: string;
  value: string;
  created_at: string;
}

export interface GapsViewProps {
  gapMemories: GapMemoryRow[];
  zeroResultSearches: ZeroResultSearchRow[];
}

/**
 * Presentational view for the global gap-detection page. Pure render — the
 * container (`page.tsx`) runs the `memory.audit_log` and `memory.memories`
 * queries and passes the resolved rows down. Read-only: no callbacks.
 */
export default function GapsView({
  gapMemories,
  zeroResultSearches,
}: GapsViewProps) {
  return (
    <div>
      <h1>Gap Detection</h1>
      <div className={styles.notice}>
        <p className={`meta ${styles.noticeText}`}>
          This is the global view across all repos. For repo-specific gaps,
          visit <a href="/">Repositories</a> and select a repo.
        </p>
      </div>

      <section className={styles.section}>
        <h2>Context Gap Draft PRs</h2>
        <p className="meta">
          The gap detection agent creates draft PRs when it identifies missing
          context.
        </p>
        <a
          href="https://github.com/re-cinq/lore/pulls?q=label:context-gap-draft"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.draftLink}
        >
          View context-gap-draft PRs on GitHub &rarr;
        </a>
      </section>

      <section className={styles.section}>
        <h2>Gap Detection Agent Findings</h2>
        {gapMemories.length === 0 ? (
          <Alert variant="secondary">
            No findings from the gap detection agent yet.
          </Alert>
        ) : (
          gapMemories.map((mem, i) => (
            <div key={i} className="spec-card">
              <h3>{mem.key}</h3>
              <span className="meta">
                <TimeAgo date={mem.created_at} />
              </span>
              <pre className={styles.findingValue}>{mem.value}</pre>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>Zero-Result Searches</h2>
        <p className="meta">
          Searches that returned no results indicate potential gaps in
          organizational context.
        </p>
        {zeroResultSearches.length === 0 ? (
          <Alert variant="secondary">No zero-result searches recorded.</Alert>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Query</th>
                <th className={styles.th}>Details</th>
                <th className={styles.th}>Time</th>
              </tr>
            </thead>
            <tbody>
              {zeroResultSearches.map((entry, i) => (
                <tr key={i}>
                  <td className={styles.td}>{entry.memory_key}</td>
                  <td className={styles.td}>
                    <code>{JSON.stringify(entry.metadata)}</code>
                  </td>
                  <td className={`meta ${styles.td}`}>
                    <TimeAgo date={entry.created_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
