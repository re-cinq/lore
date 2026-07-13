export const dynamic = "force-dynamic";
import { queryOne } from "@/lib/db";
import { Storage } from "@google-cloud/storage";
import JobRunView, { JobRunRow } from "./JobRunView";

async function fetchLogs(logPath: string | null): Promise<string | null> {
  if (!logPath) {
    return null;
  }

  try {
    const bucket = new Storage().bucket(
      process.env.LORE_LOG_BUCKET || "lore-task-logs",
    );
    const file = bucket.file(logPath);
    const [exists] = await file.exists();

    if (!exists) {
      return null;
    }
    const [content] = await file.download();

    return content.toString("utf-8");
  } catch {
    return null;
  }
}

export default async function JobRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const run = await queryOne<JobRunRow>(
    `SELECT id, job_name, status, started_at, completed_at, result_summary, error, log_path
     FROM pipeline.job_runs
     WHERE id = $1`,
    [id],
  );

  const logs = run ? await fetchLogs(run.log_path) : null;

  return <JobRunView id={id} run={run} logs={logs} />;
}
