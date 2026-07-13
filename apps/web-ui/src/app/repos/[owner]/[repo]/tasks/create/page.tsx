export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import RepoTaskCreateView from "./RepoTaskCreateView";

async function createTask(formData: FormData) {
  "use server";
  const description = formData.get("description") as string;
  const taskType = (formData.get("task_type") as string) || "general";
  const targetRepo = formData.get("target_repo") as string;
  const priority = (formData.get("priority") as string) || "normal";
  if (!description?.trim()) return;

  const resolvedPriority = priority === "immediate" ? "immediate" : "normal";
  await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
     VALUES ($1, $2, $3, 'ui', $4)`,
    [description, taskType, targetRepo, resolvedPriority],
  );
  // Also insert the initial event
  const task = await query(
    `SELECT id FROM pipeline.tasks ORDER BY created_at DESC LIMIT 1`,
  );
  if (task[0]) {
    await query(
      `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
      [task[0].id],
    );
  }
  revalidatePath(`/repos/${targetRepo}/tasks`);
  redirect(
    `/repos/${targetRepo.split("/")[0]}/${targetRepo.split("/")[1]}/tasks`,
  );
}

export default async function CreateRepoTask({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  return (
    <RepoTaskCreateView fullName={fullName} createTaskAction={createTask} />
  );
}
