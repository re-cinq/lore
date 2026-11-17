import "server-only";
import { mintCollabToken, mintPlanRunToken } from "@/lib/api/plans";
import type { PlanUser } from "@/lib/plan-user";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import type { PlanSocket } from "./plan-actions";

/** The two tokens the plan page opens its channels with, minted while it renders so the first connect needs no round trip; each is null when its mint failed, and the page then mints one itself. */
export interface PlanPageTokens {
  collab: PlanSocket | null;
  planRun: string | null;
}

/** Both tokens for a person who may see the repo; null for anyone else, who gets neither channel. */
export async function planPageTokens(
  fullName: string,
  planId: string,
  user: PlanUser | null,
): Promise<PlanPageTokens | null> {
  if (!user || !(await userCanAccessRepo(fullName))) {
    return null;
  }
  const [collab, planRun] = await Promise.all([
    mintCollabToken(fullName, planId, user, "write"),
    mintPlanRunToken(fullName, planId, user),
  ]);

  return {
    collab: collab.status === "ok" ? collab.data : null,
    planRun: planRun.status === "ok" ? planRun.data.token : null,
  };
}
