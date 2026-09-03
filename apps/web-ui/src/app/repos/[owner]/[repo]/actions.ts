"use server";

import { createOnboardTask } from "@/lib/onboard";
import { ensureWebhook } from "@/lib/webhook-api";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/** Re-run onboarding to regenerate missing scaffolding; deduplicates on re-click (#968). */
export async function reonboard(fullName: string): Promise<void> {
  const { taskId } = await createOnboardTask(fullName, { reonboard: true });

  redirect(taskId ? `/tasks/${taskId}` : `/repos/${fullName}`);
}

/** Create/repoint GitHub webhook to Floor via mcp-server; refresh overview. */
export async function setupWebhook(fullName: string): Promise<void> {
  await ensureWebhook(fullName);
  revalidatePath(`/repos/${fullName}`);
}
