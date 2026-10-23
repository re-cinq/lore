"use server";

import { revalidatePath } from "next/cache";
import { setLoopEnabled, type LoopKey } from "@/lib/api/loops";
import { onboardRepo } from "@/lib/api/repos";
import { enforceOk } from "@/lib/api/result";

/** Flip one of the repo's loops; repo identity and loop key come from the server via bound parameters, never the browser. */
export async function switchLoopAction(
  fullName: string,
  key: LoopKey,
  { enabled }: { enabled: boolean },
): Promise<void> {
  enforceOk(
    `switch ${key} loop`,
    await setLoopEnabled(fullName, key, { enabled }),
  );
  revalidateLoopsTab(fullName);
}

/** Queue the repo's onboarding again from the Loops tab. lore-api's onboard guard still refuses a duplicate, so a second click while one is running queues nothing. */
export async function retryOnboardingAction(fullName: string): Promise<void> {
  enforceOk("retry onboarding", await onboardRepo(fullName));
  revalidateLoopsTab(fullName);
}

function revalidateLoopsTab(fullName: string): void {
  const [owner, repo] = fullName.split("/");

  revalidatePath(`/repos/${owner}/${repo}/loops`);
}
