// Who may act on a plan, and the socket a plan page opens. Kept out of actions.ts: every export of a "use server" file is a callable endpoint, and these are only ever called from the server.
import "server-only";
import { mintCollabToken } from "@/lib/api/plans";
import { planUserOf, type PlanSession, type PlanUser } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import type { PlanSocket } from "./plan-actions";

export type Allowed = { user: PlanUser } | { error: string };

/** The signed-in person, when GitHub lets them see the repo. */
export async function allowedUser(fullName: string): Promise<Allowed> {
  const session = (await getSession()) as
    (PlanSession & { accessToken?: string }) | null;
  const user = planUserOf(session);

  if (!user || !session?.accessToken) {
    return { error: "Sign in to open this plan." };
  }

  return (await userCanAccessRepo(session.accessToken, fullName))
    ? { user }
    : { error: "You do not have access to this repo." };
}

/** A collab token for the plan's document, minted only after GitHub confirms the person can see the repo. */
export async function openPlanSocket(
  fullName: string,
  planId: string,
): Promise<PlanSocket | { error: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const minted = await mintCollabToken(fullName, planId, allowed.user, "write");

  return minted.status === "ok"
    ? minted.data
    : { error: "Could not open the plan." };
}
