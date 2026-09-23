"use server";

import { redirect } from "next/navigation";
import {
  approvePlan,
  askRefine,
  deletePlan,
  mintCollabToken,
  reopenPlan,
  startDrafting,
  startSpecWork,
  type RefineAsk,
} from "@/lib/api/plans";
import type { ApiResult } from "@/lib/api/result";
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

  if ("error" in allowed) {
    return allowed;
  }
  const minted = await mintCollabToken(fullName, planId, allowed.user, "write");

  return minted.status === "ok"
    ? minted.data
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
  const approved = await approvePlan(fullName, planId, allowed.user.id);

  return approved.status === "ok" ? {} : { error: approvalRefusal(approved) };
}

// A refusal carrying the validation report is the outline's job to explain; any other reason is lore-api's own sentence.
function approvalRefusal(result: ApiResult<unknown>): string {
  const problems =
    result.status === "error" &&
    (result.body as { problems?: unknown }).problems;

  return problems ? "The plan is not ready to approve yet." : refusalOf(result);
}

// lore-api's reasons are lower-case clauses; the page shows them as sentences.
function refusalOf(result: ApiResult<unknown>): string {
  const reason = result.status === "error" ? result.message : "";

  return reason
    ? `${reason[0].toUpperCase()}${reason.slice(1)}.`
    : "Something went wrong.";
}

/** An approved plan back to writing; an open spec PR is sent back to the author, and approving again updates it. */
export async function reopenPlanAction(
  fullName: string,
  planId: string,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const reopened = await reopenPlan(fullName, planId, allowed.user.id);

  return reopened.status === "ok" ? {} : { error: refusalOf(reopened) };
}

/** Deletes the plan for good and goes back to the repo's plans. */
export async function deletePlanAction(
  fullName: string,
  planId: string,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const deleted = await deletePlan(fullName, planId);

  if (deleted.status !== "ok") {
    return { error: refusalOf(deleted) };
  }
  redirect(`/repos/${fullName}/plans`);
}

/** A fresh spec pass for an approved plan whose spec work failed, or whose merged specs it revises. */
export async function retrySpecWorkAction(
  fullName: string,
  planId: string,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const started = await startSpecWork(fullName, planId, allowed.user.id);

  return started.status === "ok" ? {} : { error: refusalOf(started) };
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

/** A fresh draft for a plan whose planning run failed or never started — the run page cannot retry a run that failed on its first node. */
export async function draftAgainAction(
  fullName: string,
  planId: string,
): Promise<{ error?: string }> {
  const allowed = await allowedUser(fullName);

  if ("error" in allowed) {
    return allowed;
  }
  const started = await startDrafting(fullName, planId, "", allowed.user.id);

  return started.status === "ok"
    ? {}
    : { error: "Could not start a new draft." };
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
