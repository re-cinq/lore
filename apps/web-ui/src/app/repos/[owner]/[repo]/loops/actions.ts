"use server";

import { revalidatePath } from "next/cache";
import {
  resumeLoop,
  setLoopEnabled,
  type LoopKey,
  type SwitchRequest,
} from "@/lib/api/loops";
import { onboardRepo } from "@/lib/api/repos";
import { enforceOk } from "@/lib/api/result";
import { refusalReason } from "./switch-refusal";

/** Flip one of the repo's loops; repo identity and loop key come from the server via bound parameters, never the browser. Answers why lore-api refused, or null: a thrown message is hidden from the browser in production, and a refused switch must say what is missing. */
export async function switchLoopAction(
  fullName: string,
  key: LoopKey,
  asked: SwitchRequest,
): Promise<string | null> {
  const result = await setLoopEnabled(fullName, key, asked);

  if (result.status !== "ok") {
    return refusalReason(result);
  }
  revalidateLoopsTab(fullName);

  return null;
}

/** Resume one of the repo's paused loops; answers why lore-api refused, or null, like the switch. */
export async function resumeLoopAction(
  fullName: string,
  key: LoopKey,
): Promise<string | null> {
  const result = await resumeLoop(fullName, key);

  if (result.status !== "ok") {
    return refusalReason(result);
  }
  revalidateLoopsTab(fullName);

  return null;
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
