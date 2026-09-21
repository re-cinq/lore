"use server";

import {
  approvePlan,
  askRefine,
  mintCollabToken,
  type RefineAsk,
} from "@/lib/api/plans";
import { planSocketUrl } from "@/lib/plan-input";
import { planUserOf, type PlanSession, type PlanUser } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import type { PlanSocket } from "./plan-actions";

type Allowed = { user: PlanUser } | { error: string };

export async function openPlanSocketAction(
  fullName: string,
  planId: string,
): Promise<PlanSocket | { error: string }> {
  const allowed = await allowedUser(fullName);
  const wsUrl = planSocketUrl(process.env);

  if ("error" in allowed) {
    return allowed;
  }

  if (!wsUrl) {
    return { error: "The plan socket is not configured (LORE_PLANS_WS_URL)." };
  }
  const minted = await mintCollabToken(fullName, planId, allowed.user, "write");

  return minted.status === "ok"
    ? { wsUrl, ...minted.data }
    : { error: "Could not open the plan." };
}

export async function approvePlanAction(
  fullName: string,
  planId: string,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const approved = await approvePlan(planId, allowed.user.id);

  return approved.status === "ok"
    ? {}
    : { error: "The plan is not ready to approve yet." };
}

export async function refinePlanAction(
  fullName: string,
  planId: string,
  refine: RefineAsk,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const asked = await askRefine(fullName, planId, refine);

  return asked.status === "ok"
    ? {}
    : { error: "The planning agent is still working on this plan." };
}

// Every action is bound to one plan of one repo on the server; the person must be signed in and able to see the repo on GitHub.
async function allowedUser(fullName: string): Promise<Allowed> {
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
