export const dynamic = "force-dynamic";
import { createTask as queueTask } from "@/lib/api/tasks";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import RepoTaskCreateView from "./RepoTaskCreateView";

function taskFormFields(formData: FormData) {
  return {
    description: formData.get("description") as string,
    taskType: (formData.get("task_type") as string) || "general",
    targetRepo: formData.get("target_repo") as string,
    priority:
      (formData.get("priority") as string) === "immediate"
        ? "immediate"
        : "normal",
  };
}

/** Land on task detail on success, or repo tasks tab on failure. */
function taskRedirectPath(
  created: Awaited<ReturnType<typeof queueTask>>,
  targetRepo: string,
) {
  if (created.status === "ok") {
    return `/tasks/${created.data.task_id}`;
  }
  const [owner, repo] = targetRepo.split("/");

  return `/repos/${owner}/${repo}/tasks`;
}

async function createTask(formData: FormData) {
  "use server";
  const { description, taskType, targetRepo, priority } =
    taskFormFields(formData);

  if (!description?.trim()) {
    return;
  }

  // lore-api returns the task id directly (race condition risk eliminated).
  const created = await queueTask({
    description,
    taskType,
    targetRepo,
    priority,
    createdBy: "ui",
  });

  revalidatePath(`/repos/${targetRepo}/tasks`);
  redirect(taskRedirectPath(created, targetRepo));
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
