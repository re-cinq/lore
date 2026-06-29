'use server';

import { createOnboardTask } from '@/lib/onboard';
import { ensureWebhook } from '@/lib/webhook-api';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

/**
 * Re-run onboarding for a repo to regenerate missing scaffolding (e.g. the
 * ingest workflow). The agent opens a PR with only the missing files; land the
 * user on the task page where that PR link surfaces, or back on the repo page
 * if the task could not be created.
 */
export async function reonboard(fullName: string): Promise<void> {
  const id = await createOnboardTask(fullName);
  redirect(id ? `/assembly-lines/${id}` : `/repos/${fullName}`);
}

/**
 * Create or repoint this repo's GitHub webhook to the Floor (correct URL, events,
 * and HMAC secret) via mcp-server, then refresh the overview so the check updates.
 */
export async function setupWebhook(fullName: string): Promise<void> {
  await ensureWebhook(fullName);
  revalidatePath(`/repos/${fullName}`);
}
