export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import { createTask as queueTask } from "@/lib/api/tasks";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AssemblyRunCreateView from "./AssemblyRunCreateView";

async function createTask(formData: FormData) {
  "use server";
  const description = formData.get("description") as string;
  const taskType = (formData.get("task_type") as string) || "general";
  const targetRepo = (formData.get("target_repo") as string) || "re-cinq/lore";
  const priority = (formData.get("priority") as string) || "normal";

  if (!description?.trim()) {
    return;
  }

  const session = await getSession();
  const createdBy = (session?.user?.name ||
    session?.user?.email ||
    "ui") as string;
  const resolvedPriority = priority === "immediate" ? "immediate" : "normal";

  const created = await queueTask({
    description,
    taskType,
    targetRepo,
    priority: resolvedPriority,
    createdBy,
  });

  if (created.status !== "ok") {
    return;
  }
  // Land on the task detail — a fresh task has no run row yet (it only appears in
  // the run list once execution starts), and Run Now / Cancel live on task detail.
  revalidatePath("/assembly-runs");
  redirect(`/tasks/${created.data.task_id}`);
}

export default async function CreateTaskPage() {
  const repoList = reposOrThrow(await listAllRepos());
  const onboardedRepos = repoList.repos
    .map((repo) => ({ full_name: repo.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <AssemblyRunCreateView
      onboardedRepos={onboardedRepos}
      createTaskAction={createTask}
    />
  );
}
