"use server";

import { createTask as queueTask } from "@/lib/api/tasks";
import { getSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

interface CreateTaskFields {
  description: string;
  taskType: string;
  targetRepo: string;
  priority: string;
}

function readCreateTaskFields(formData: FormData): CreateTaskFields {
  return {
    description: formData.get("description") as string,
    taskType: (formData.get("task_type") as string) || "general",
    targetRepo: (formData.get("target_repo") as string) || "re-cinq/lore",
    priority: formData.get("priority") === "immediate" ? "immediate" : "normal",
  };
}

function resolveCreatedBy(
  session: { user?: { name?: string | null; email?: string | null } } | null,
): string {
  const user = session?.user;

  return (user?.name || user?.email || "ui") as string;
}

export async function createTask(formData: FormData) {
  const fields = readCreateTaskFields(formData);

  if (!fields.description?.trim()) {
    return;
  }

  const createdBy = resolveCreatedBy(await getSession());
  const created = await queueTask({
    description: fields.description,
    taskType: fields.taskType,
    targetRepo: fields.targetRepo,
    priority: fields.priority,
    createdBy,
  });

  if (created.status !== "ok") {
    return;
  }
  // Land on the task detail — a fresh task has no run row yet, and Run Now / Cancel live there.
  revalidatePath("/assembly-runs");
  redirect(`/tasks/${created.data.task_id}`);
}
