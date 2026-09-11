"use server";

import { revalidatePath } from "next/cache";
import { setImplementationLoopEnabled } from "@/lib/api/backlog";
import { onboardRepo } from "@/lib/api/repos";
import { enforceOk } from "@/lib/api/result";

/** Flip repo's backlog loop; repo identity from server via bound parameter, never browser. */
export async function toggleImplementationLoopAction(
  fullName: string,
  { enabled }: { enabled: boolean },
): Promise<void> {
  enforceOk(
    "toggle implementation loop",
    await setImplementationLoopEnabled(fullName, { enabled }),
  );
  revalidateLoopTab(fullName);
}

/** Queue the repo's onboarding again from the loop tab. lore-api's onboard guard still refuses a duplicate, so a second click while one is running queues nothing. */
export async function retryOnboardingAction(fullName: string): Promise<void> {
  enforceOk("retry onboarding", await onboardRepo(fullName));
  revalidateLoopTab(fullName);
}

function revalidateLoopTab(fullName: string): void {
  const [owner, repo] = fullName.split("/");

  revalidatePath(`/repos/${owner}/${repo}/implementation-loop`);
}
