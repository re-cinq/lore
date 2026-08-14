export const dynamic = "force-dynamic";
import { getJobRun } from "@/lib/api/activity";
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

  const result = await getJobRun(id);
  const run: JobRunRow | null = result.status === "ok" ? result.data : null;

  const logs = run ? await fetchLogs(run.log_path) : null;

  return <JobRunView id={id} run={run} logs={logs} />;
}
