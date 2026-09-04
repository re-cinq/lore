import { Alert } from "@/components/Alert";
import Link from "next/link";
import styles from "./JobRunView.module.css";
import type { components } from "@/lib/api/schema";

/** One `pipeline.job_runs` row, as `/api/job-runs/{id}` publishes it. */
export type JobRunRow = components["schemas"]["JobRun"];

export interface JobRunViewProps {
  id: string;
  run: JobRunRow | null;
  logs: string | null;
}

function NotFound({ id }: { id: string }) {
  return (
    <div>
      <h1>Job Run</h1>
      <Alert variant="secondary">Run not found: {id}</Alert>
      <p>
        <Link href="/analytics">← Back to analytics</Link>
      </p>
    </div>
  );
}

function RunFacts({ run }: { run: JobRunRow }) {
  return (
    <div className={`spec-card ${styles.card}`}>
      <div>
        <span className="meta">Run ID:</span> <code>{run.id}</code>
      </div>
      <div>
        <span className="meta">Started:</span>{" "}
        {new Date(run.started_at).toLocaleString()}
      </div>
      {run.completed_at && (
        <div>
          <span className="meta">Completed:</span>{" "}
          {new Date(run.completed_at).toLocaleString()}
        </div>
      )}
      {run.result_summary && (
        <div>
          <span className="meta">Summary:</span> {run.result_summary}
        </div>
      )}
      {run.error && (
        <div className={styles.error}>
          <span className="meta">Error:</span> {run.error}
        </div>
      )}
      {run.log_path && (
        <div>
          <span className="meta">Log path:</span> <code>{run.log_path}</code>
        </div>
      )}
    </div>
  );
}

function missingLogMessage(logPath: string | null): string {
  return logPath
    ? "Log object missing or unreadable."
    : "No log_path recorded for this run (in-process jobs do not yet capture per-run output).";
}

function OutputSection({
  logs,
  logPath,
}: {
  logs: string | null;
  logPath: string | null;
}) {
  if (logs === null) {
    return <Alert variant="secondary">{missingLogMessage(logPath)}</Alert>;
  }

  return <pre className={styles.output}>{logs}</pre>;
}

export default function JobRunView({ id, run, logs }: JobRunViewProps) {
  if (!run) {
    return <NotFound id={id} />;
  }

  return (
    <div>
      <p>
        <Link href="/analytics">← Back to analytics</Link>
      </p>
      <h1>
        <span className="badge">{run.job_name}</span>{" "}
        <span className={`op-badge op-${run.status}`}>{run.status}</span>
      </h1>

      <RunFacts run={run} />

      <h2>Output</h2>
      <OutputSection logs={logs} logPath={run.log_path} />
    </div>
  );
}
