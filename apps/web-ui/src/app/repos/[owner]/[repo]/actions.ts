"use server";

import { createOnboardTask } from "@/lib/onboard";
import { ensureWebhook } from "@/lib/webhook-api";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/** Re-run onboarding to regenerate missing scaffolding; deduplicates on re-click (#968). Lands on the run: the run page resolves a task id to the task's run. */
export async function reonboard(
  fullName: string,
): Promise<{ error?: string } | void> {
  const result = await createOnboardTask(fullName, { reonboard: true });

  if (result.ok || result.taskId) {
    redirect(`/assembly-runs/${result.taskId}`);
  }

  return { error: result.message };
}

/** Create/repoint the repo's GitHub webhook at the public webhook URL via lore-api; refresh overview. */
export async function setupWebhook(
  fullName: string,
): Promise<{ error?: string } | void> {
  const result = await ensureWebhook(fullName);

  if ("error" in result) {
    return { error: result.error };
  }

  revalidatePath(`/repos/${fullName}`);
}
