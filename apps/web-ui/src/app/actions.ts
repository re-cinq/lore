"use server";

import { createOnboardTask } from "@/lib/onboard";
import { setupOutcome, type SetupOutcome } from "@/lib/update-setup-result";

/** Re-onboard each repo: the onboarding line rewrites its ingest variable and secret, opens a PR only for Lore files that differ, and starts the ingest workflows. Fail-soft per repo, every refusal reported with its reason. */
export async function updateSetup(repos: string[]): Promise<SetupOutcome[]> {
  return Promise.all(repos.map(reonboardOutcome));
}

async function reonboardOutcome(repo: string): Promise<SetupOutcome> {
  try {
    return setupOutcome(
      repo,
      await createOnboardTask(repo, { reonboard: true }),
    );
  } catch (err) {
    return {
      repo,
      status: "refused",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
