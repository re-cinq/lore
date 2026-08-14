export const dynamic = "force-dynamic";
import { createTask as queueTask } from "@/lib/api/tasks";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import RepoTaskCreateView from "./RepoTaskCreateView";

async function createTask(formData: FormData) {
  "use server";
  const description = formData.get("description") as string;
  const taskType = (formData.get("task_type") as string) || "general";
  const targetRepo = formData.get("target_repo") as string;
  const priority = (formData.get("priority") as string) || "normal";

  if (!description?.trim()) {
    return;
  }

  const resolvedPriority = priority === "immediate" ? "immediate" : "normal";

  // lore-api returns the id of the task it just created. The previous code
  // inserted, then read back the NEWEST task in the whole table to learn which
  // one was its own — so two concurrent submissions, from any repo by any user,
  // and this page attached its pending event to a stranger's task and sent the
  // author to that task's page.
  const created = await queueTask({
    description,
    taskType,
    targetRepo,
    priority: resolvedPriority,
    createdBy: "ui",
  });

  revalidatePath(`/repos/${targetRepo}/tasks`);
  // Land on the task detail (Run Now / Cancel live there); fall back to the repo
  // tab when the submission failed.
  redirect(
    created.status === "ok"
      ? `/tasks/${created.data.task_id}`
      : `/repos/${targetRepo.split("/")[0]}/${targetRepo.split("/")[1]}/tasks`,
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
