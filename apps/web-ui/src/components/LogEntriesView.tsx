import {
  clip,
  rateLimitSummary,
  formatDuration,
  formatTokens,
  type LogEntry,
} from "@/lib/agent-log-entries";
import styles from "./LogEntriesView.module.css";

const INLINE_RESULT_MAX = 160;

function resultSummary(entry: Extract<LogEntry, { kind: "result" }>): string {
  const parts = [entry.isError ? "✗ failed" : "✓ finished"];

  if (entry.durationMs !== undefined) {
    parts.push(` — ${formatDuration(entry.durationMs)}`);
  }

  if (entry.costUsd !== undefined) {
    parts.push(` · $${entry.costUsd.toFixed(2)}`);
  }

  if (entry.numTurns !== undefined) {
    parts.push(` · ${entry.numTurns} turns`);
  }

  return parts.join("");
}

/** How a hook's line reads: its verdict once it has one, else that it is still
 *  going. Formatted here rather than in JSX so it is testable without a DOM. */
export function hookSummary(
  entry: Extract<LogEntry, { kind: "hook" }>,
): string {
  const exit = entry.exitCode === undefined ? "" : ` (exit ${entry.exitCode})`;
  const status =
    entry.outcome === undefined
      ? "running…"
      : `${entry.exitCode === 0 ? "✓" : "✗"}${exit}`;

  return `· hook ${entry.hookName} ${status}`;
}

/** One entry's line. Exported so a view that adds its own gutter (the run
 *  page's timestamped transcript) reuses this switch instead of copying it. */
export function EntryLine({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "lifecycle":
      return (
        <div className={styles.dim}>
          · {entry.phase ?? "agent"} {entry.status}
          {entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ""}
        </div>
      );
    case "session-init":
      return (
        <details className={styles.dim}>
          <summary className={styles.summary}>
            session started — {entry.model}
            {entry.version ? ` (Claude Code ${entry.version})` : ""}
          </summary>
          <pre className={styles.detailsPre}>{entry.detailsJson}</pre>
        </details>
      );
    case "thinking-tokens":
      return (
        <div className={styles.thinking}>
          thinking… {formatTokens(entry.tokens)} tokens
        </div>
      );
    case "thinking":
      return <div className={styles.thinking}>{entry.text}</div>;
    case "assistant-text":
      return <div className={styles.text}>{entry.text}</div>;
    case "tool-use":
      return <div className={styles.tool}>{entry.summary}</div>;
    case "tool-result": {
      const errorClass = entry.isError ? ` ${styles.error}` : "";

      if (
        entry.text.length <= INLINE_RESULT_MAX &&
        !entry.text.includes("\n")
      ) {
        return <div className={styles.dim + errorClass}>← {entry.text}</div>;
      }

      return (
        <details className={styles.dim + errorClass}>
          <summary className={styles.summary}>
            ← {clip(entry.text, INLINE_RESULT_MAX)}
          </summary>
          <pre className={styles.detailsPre}>{entry.text}</pre>
        </details>
      );
    }
    case "user-text":
      return (
        <details className={styles.dim}>
          <summary className={styles.summary}>
            user: {clip(entry.text, INLINE_RESULT_MAX)}
          </summary>
          <pre className={styles.detailsPre}>{entry.text}</pre>
        </details>
      );
    case "result":
      return (
        <div className={styles.resultFooter}>
          <div className={entry.isError ? styles.error : styles.text}>
            {resultSummary(entry)}
          </div>
          {entry.text && (
            <details className={styles.dim}>
              <summary className={styles.summary}>result</summary>
              <pre className={styles.detailsPre}>{entry.text}</pre>
            </details>
          )}
        </div>
      );
    case "rate-limit":
      return <div className={styles.rateLimit}>{rateLimitSummary(entry)}</div>;
    case "hook": {
      const errorClass =
        entry.exitCode !== undefined && entry.exitCode !== 0
          ? ` ${styles.error}`
          : "";

      if (!entry.output) {
        return (
          <div className={styles.dim + errorClass}>{hookSummary(entry)}</div>
        );
      }

      return (
        <details className={styles.dim + errorClass}>
          <summary className={styles.summary}>{hookSummary(entry)}</summary>
          <pre className={styles.detailsPre}>{entry.output}</pre>
        </details>
      );
    }
    case "system":
      return (
        <details className={styles.dim}>
          <summary className={styles.summary}>
            · system: {entry.subtype}
          </summary>
          <pre className={styles.detailsPre}>{entry.detailsJson}</pre>
        </details>
      );
    case "station-log":
      return <div className={styles.dim}>· {entry.text}</div>;
    case "raw":
      return <div className={styles.rawLine}>{entry.text}</div>;
  }
}

export default function LogEntriesView({ entries }: { entries: LogEntry[] }) {
  return (
    <>
      {entries.map((entry, index) => (
        <EntryLine key={index} entry={entry} />
      ))}
    </>
  );
}
