'use server';

import { createOnboardTask } from '@/lib/onboard';
import { redirect } from 'next/navigation';

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
