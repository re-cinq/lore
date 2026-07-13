export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AssemblyLineCreateView from "./AssemblyLineCreateView";

async function createTask(formData: FormData) {
  "use server";
  const description = formData.get("description") as string;
  const taskType = (formData.get("task_type") as string) || "general";
  const targetRepo = (formData.get("target_repo") as string) || "re-cinq/lore";
  const priority = (formData.get("priority") as string) || "normal";
  if (!description?.trim()) return;

  const session = await getSession();
  const createdBy = (session?.user?.name ||
    session?.user?.email ||
    "ui") as string;
  const resolvedPriority = priority === "immediate" ? "immediate" : "normal";

  const result = await query(
    `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [description, taskType, targetRepo, createdBy, resolvedPriority],
  );
  await query(
    `INSERT INTO pipeline.task_events (task_id, to_status) VALUES ($1, 'pending')`,
    [result[0].id],
  );
  revalidatePath("/assembly-lines");
  redirect("/assembly-lines");
}

export default async function CreateTaskPage() {
  // Query onboarded repos from lore.repos for the dropdown
  const onboardedRepos = await query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos ORDER BY full_name`,
  );

  return (
    <AssemblyLineCreateView
      onboardedRepos={onboardedRepos}
      createTaskAction={createTask}
    />
  );
}
