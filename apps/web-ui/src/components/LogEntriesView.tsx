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

/** The exit code decides when present; without it, a non-zero exit is never assumed, or every still-running hook would read failed. */
function hookPassed(entry: Extract<LogEntry, { kind: "hook" }>): boolean {
  return entry.exitCode === undefined
    ? entry.outcome === "success"
    : entry.exitCode === 0;
}

/** Formatted here rather than in JSX so it is testable without a DOM. */
export function hookSummary(
  entry: Extract<LogEntry, { kind: "hook" }>,
): string {
  const exit = entry.exitCode === undefined ? "" : ` (exit ${entry.exitCode})`;
  const status =
    entry.outcome === undefined
      ? "running…"
      : `${hookPassed(entry) ? "✓" : "✗"}${exit}`;

  return `· hook ${entry.hookName} ${status}`;
}

/** Elapsed seconds are the total for the call, so the folded run's newest beat is the whole clock. */
export function toolProgressSummary(
  entry: Extract<LogEntry, { kind: "tool-progress" }>,
): string {
  const clock =
    entry.elapsedSeconds === undefined
      ? ""
      : ` (${formatDuration(entry.elapsedSeconds * 1000)})`;

  return `· ${entry.toolName} still running…${clock}`;
}

/** Exported so a view that adds its own gutter (the run page's timestamped transcript) reuses this switch instead of copying it. */
/** One transcript line; split into three groups. */
export function EntryLine({ entry }: { entry: LogEntry }) {
  return (
    sessionLine(entry) ??
    agentLine(entry) ??
    reportLine(entry) ??
    rawLine(entry)
  );
}

function lifecycleLine(entry: Extract<LogEntry, { kind: "lifecycle" }>) {
  const exit = entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : "";

  return (
    <div className={styles.dim}>
      · {entry.phase ?? "agent"} {entry.status}
      {exit}
    </div>
  );
}

function sessionInitLine(entry: Extract<LogEntry, { kind: "session-init" }>) {
  const version = entry.version ? ` (Claude Code ${entry.version})` : "";

  return (
    <details className={styles.dim}>
      <summary className={styles.summary}>
        session started — {entry.model}
        {version}
      </summary>
      <pre className={styles.detailsPre}>{entry.detailsJson}</pre>
    </details>
  );
}

function thinkingTokensLine(entry: LogEntry) {
  return entry.kind === "thinking-tokens" ? (
    <div className={styles.thinking}>
      thinking… {formatTokens(entry.tokens)} tokens
    </div>
  ) : null;
}

/** The run's own bookkeeping: start, stop, and the thinking meter. */
function sessionLine(entry: LogEntry) {
  if (entry.kind === "lifecycle") {
    return lifecycleLine(entry);
  }

  if (entry.kind === "session-init") {
    return sessionInitLine(entry);
  }

  return thinkingTokensLine(entry);
}

/** What the agent said and did: its thinking, its text, its tool calls. */
function agentLine(entry: LogEntry) {
  if (entry.kind === "thinking") {
    return <div className={styles.thinking}>{entry.text}</div>;
  }

  if (entry.kind === "assistant-text") {
    return <div className={styles.text}>{entry.text}</div>;
  }

  if (entry.kind === "tool-use") {
    return <div className={styles.tool}>{entry.summary}</div>;
  }

  if (entry.kind === "tool-progress") {
    return <div className={styles.dim}>{toolProgressSummary(entry)}</div>;
  }

  return toolResultLine(entry) ?? userTextLine(entry);
}

/** A short single-line result reads inline; anything longer folds away. */
function toolResultLine(entry: LogEntry) {
  if (entry.kind !== "tool-result") {
    return null;
  }
  const errorClass = entry.isError ? ` ${styles.error}` : "";

  if (entry.text.length <= INLINE_RESULT_MAX && !entry.text.includes("\n")) {
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

function userTextLine(entry: LogEntry) {
  return entry.kind === "user-text" ? (
    <details className={styles.dim}>
      <summary className={styles.summary}>
        user: {clip(entry.text, INLINE_RESULT_MAX)}
      </summary>
      <pre className={styles.detailsPre}>{entry.text}</pre>
    </details>
  ) : null;
}

function resultLine(entry: Extract<LogEntry, { kind: "result" }>) {
  const summaryClass = entry.isError ? styles.error : styles.text;

  return (
    <div className={styles.resultFooter}>
      <div className={summaryClass}>{resultSummary(entry)}</div>
      {entry.text && (
        <details className={styles.dim}>
          <summary className={styles.summary}>result</summary>
          <pre className={styles.detailsPre}>{entry.text}</pre>
        </details>
      )}
    </div>
  );
}

function agentErrorLine(entry: Extract<LogEntry, { kind: "agent-error" }>) {
  return (
    <div className={entry.severity === "error" ? styles.error : styles.dim}>
      ✗ {entry.severity}: {entry.message}
    </div>
  );
}

/** How the run reports itself: its verdict, its limits, its failures, its artifacts. */
function reportLine(entry: LogEntry) {
  if (entry.kind === "result") {
    return resultLine(entry);
  }

  if (entry.kind === "rate-limit") {
    return <div className={styles.rateLimit}>{rateLimitSummary(entry)}</div>;
  }

  if (entry.kind === "agent-error") {
    return agentErrorLine(entry);
  }

  return hookLine(entry) ?? stationLine(entry);
}

/** A hook that failed carries its output; one that passed is a single line. */
function hookLine(entry: LogEntry) {
  if (entry.kind !== "hook") {
    return null;
  }
  const errorClass =
    entry.outcome !== undefined && !hookPassed(entry) ? ` ${styles.error}` : "";

  if (!entry.output) {
    return <div className={styles.dim + errorClass}>{hookSummary(entry)}</div>;
  }

  return (
    <details className={styles.dim + errorClass}>
      <summary className={styles.summary}>{hookSummary(entry)}</summary>
      <pre className={styles.detailsPre}>{entry.output}</pre>
    </details>
  );
}

/** What the station said around the agent: its own log, a system event, a declared artifact. */
function stationLine(entry: LogEntry) {
  if (entry.kind === "system") {
    return (
      <details className={styles.dim}>
        <summary className={styles.summary}>· system: {entry.subtype}</summary>
        <pre className={styles.detailsPre}>{entry.detailsJson}</pre>
      </details>
    );
  }

  if (entry.kind === "station-log") {
    return <div className={styles.dim}>· {entry.text}</div>;
  }

  return fileLine(entry);
}

/** A declared artifact that never arrived is a failure, not a fold-away. */
function fileLine(entry: LogEntry) {
  if (entry.kind !== "file") {
    return null;
  }

  if (entry.reason !== undefined) {
    return (
      <div className={styles.error}>
        ✗ {entry.event} not produced: {entry.reason}
      </div>
    );
  }

  return (
    <details className={styles.dim}>
      <summary className={styles.summary}>
        ⇢ {entry.event} — {entry.path}
      </summary>
      <pre className={styles.detailsPre}>{entry.content}</pre>
    </details>
  );
}

function rawLine(entry: LogEntry) {
  return entry.kind === "raw" ? (
    <div className={styles.rawLine}>{entry.text}</div>
  ) : null;
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
