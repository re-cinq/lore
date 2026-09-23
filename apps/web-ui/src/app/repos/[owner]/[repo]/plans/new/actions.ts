"use server";

import { redirect } from "next/navigation";
import { createPlan, seedPlan, startDrafting } from "@/lib/api/plans";
import type { ApiResult } from "@/lib/api/result";
import {
  newPlanInput,
  paragraphsOf,
  type NewPlanInput,
} from "@/lib/plan-input";
import { planUserOf, type PlanSession, type PlanUser } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

export interface CreatePlanState {
  error?: string;
}

// The repo is bound on the server (NewPlanPage), never read from the form.
export async function createPlanAction(
  fullName: string,
  _prev: CreatePlanState | null,
  formData: FormData,
): Promise<CreatePlanState> {
  const request = await planRequest(formData);

  if ("error" in request) {
    return request;
  }
  const created = await createSeededPlan(fullName, request);

  if ("error" in created) {
    return created;
  }
  redirect(`/repos/${fullName}/plans/${created.id}`);
}

// The plan in lore-api, with what the author already knew written into its intent, and the planning agent asked for its first draft.
async function createSeededPlan(
  fullName: string,
  { input, user }: { input: NewPlanInput; user: PlanUser },
): Promise<{ id: string } | { error: string }> {
  const created = await createPlan({
    repo: fullName,
    title: input.title,
    type: input.type,
    createdBy: user.id,
  });

  if (created.status !== "ok") {
    return { error: failureOf(created) };
  }
  const { id } = created.data.meta;

  await seedIntent(id, user.id, input.description);
  await startDrafting(fullName, id, input.description, user.id);

  return { id };
}

// A valid form from a signed-in person, or what is wrong with it.
async function planRequest(
  formData: FormData,
): Promise<{ input: NewPlanInput; user: PlanUser } | { error: string }> {
  const input = newPlanInput(formData);
  const user = planUserOf((await getSession()) as PlanSession | null);

  if ("error" in input) {
    return input;
  }

  return user ? { input, user } : { error: "Sign in to create a plan." };
}

// What the author already knew becomes the plan's intent; an empty description leaves the template's own.
async function seedIntent(
  planId: string,
  actor: string,
  description: string,
): Promise<void> {
  const intent = paragraphsOf(description);

  if (intent.length > 0) {
    await seedPlan(planId, actor, intent);
  }
}

function failureOf(
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): string {
  return result.status === "unconfigured"
    ? "The plans API is not configured (LORE_API_URL / token)."
    : result.message;
}
