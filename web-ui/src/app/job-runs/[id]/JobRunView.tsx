import Link from "next/link";
import styles from "./JobRunView.module.css";

export interface JobRunRow {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  error: string | null;
  log_path: string | null;
}

export interface JobRunViewProps {
  id: string;
  run: JobRunRow | null;
  logs: string | null;
}

export default function JobRunView({ id, run, logs }: JobRunViewProps) {
  if (!run) {
    return (
      <div>
        <h1>Job Run</h1>
        <p className="meta">Run not found: {id}</p>
        <p><Link href="/analytics">← Back to analytics</Link></p>
      </div>
    );
  }

  return (
    <div>
      <p><Link href="/analytics">← Back to analytics</Link></p>
      <h1><span className="badge">{run.job_name}</span> <span className={`op-badge op-${run.status}`}>{run.status}</span></h1>

      <div className={`spec-card ${styles.card}`}>
        <div><span className="meta">Run ID:</span> <code>{run.id}</code></div>
        <div><span className="meta">Started:</span> {new Date(run.started_at).toLocaleString()}</div>
        {run.completed_at && (
          <div><span className="meta">Completed:</span> {new Date(run.completed_at).toLocaleString()}</div>
        )}
        {run.result_summary && (
          <div><span className="meta">Summary:</span> {run.result_summary}</div>
        )}
        {run.error && (
          <div className={styles.error}><span className="meta">Error:</span> {run.error}</div>
        )}
        {run.log_path && (
          <div><span className="meta">Log path:</span> <code>{run.log_path}</code></div>
        )}
      </div>

      <h2>Output</h2>
      {logs === null ? (
        <p className="meta">
          {run.log_path
            ? "Log object missing or unreadable."
            : "No log_path recorded for this run (in-process jobs do not yet capture per-run output)."}
        </p>
      ) : (
        <pre className={styles.output}>{logs}</pre>
      )}
    </div>
  );
}
