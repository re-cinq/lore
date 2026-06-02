export const dynamic = "force-dynamic";
import Link from "next/link";
import { queryOne } from "@/lib/db";
import { Storage } from "@google-cloud/storage";

interface JobRun {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  result_summary: string | null;
  error: string | null;
  log_path: string | null;
}

async function fetchLogs(logPath: string | null): Promise<string | null> {
  if (!logPath) return null;
  try {
    const bucket = new Storage().bucket(process.env.LORE_LOG_BUCKET || "lore-task-logs");
    const file = bucket.file(logPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return content.toString("utf-8");
  } catch {
    return null;
  }
}

export default async function JobRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const run = await queryOne<JobRun>(
    `SELECT id, job_name, status, started_at, completed_at, result_summary, error, log_path
     FROM pipeline.job_runs
     WHERE id = $1`,
    [id],
  );

  if (!run) {
    return (
      <div>
        <h1>Job Run</h1>
        <p className="meta">Run not found: {id}</p>
        <p><Link href="/analytics">← Back to analytics</Link></p>
      </div>
    );
  }

  const logs = await fetchLogs(run.log_path);

  return (
    <div>
      <p><Link href="/analytics">← Back to analytics</Link></p>
      <h1><span className="badge">{run.job_name}</span> <span className={`op-badge op-${run.status}`}>{run.status}</span></h1>

      <div className="spec-card" style={{marginBottom: "16px"}}>
        <div><span className="meta">Run ID:</span> <code>{run.id}</code></div>
        <div><span className="meta">Started:</span> {new Date(run.started_at).toLocaleString()}</div>
        {run.completed_at && (
          <div><span className="meta">Completed:</span> {new Date(run.completed_at).toLocaleString()}</div>
        )}
        {run.result_summary && (
          <div><span className="meta">Summary:</span> {run.result_summary}</div>
        )}
        {run.error && (
          <div style={{color: "var(--danger)"}}><span className="meta">Error:</span> {run.error}</div>
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
        <pre style={{
          background: "var(--bg-mono)",
          padding: "12px",
          overflowX: "auto",
          fontSize: "var(--fs-sm)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "pre-wrap",
          maxHeight: "70vh",
        }}>{logs}</pre>
      )}
    </div>
  );
}
