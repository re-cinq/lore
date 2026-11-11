"use server";

import { redirect } from "next/navigation";
import {
  createPlan,
  seedPlan,
  startDrafting,
  type DraftingRequest,
} from "@/lib/api/plans";
import type { ApiResult } from "@/lib/api/result";
import { newPlanInput, type NewPlanInput } from "@/lib/plan-input";
import { planUserOf, type PlanSession, type PlanUser } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

export interface CreatePlanState {
  error?: string;
  planId?: string;
}

// The repo is bound on the server (NewPlanPage), never read from the form.
export async function createPlanAction(
  fullName: string,
  _prev: CreatePlanState | null,
  formData: FormData,
): Promise<CreatePlanState> {
  const request = await planRequest(formData, fullName);

  if ("error" in request) {
    return request;
  }
  // A retry carries the already-created plan ID; skip creation to avoid a duplicate.
  const created = await createSeededPlan(fullName, request, _prev?.planId);

  if ("error" in created) {
    return created;
  }
  redirect(`/repos/${fullName}/plans/${created.id}`);
}

// The plan in lore-api, with what the author already knew written into its intent, and the planning agent asked for its first draft.
async function createSeededPlan(
  fullName: string,
  { input, user }: { input: NewPlanInput; user: PlanUser },
  existingPlanId?: string,
): Promise<{ id: string } | { error: string; planId?: string }> {
  const resolved = await planIdOf(fullName, input, user, existingPlanId);

  if ("error" in resolved) {
    return resolved;
  }

  return seedAndDraft(fullName, resolved.id, input, user);
}

async function seedAndDraft(
  fullName: string,
  id: string,
  input: NewPlanInput,
  user: PlanUser,
): Promise<{ id: string } | { error: string; planId: string }> {
  const seedError = await seedIntent(id, user.id, input.description);

  if (seedError !== null) {
    return { error: failureOf(seedError), planId: id };
  }
  const drafted = await startDrafting(
    fullName,
    id,
    draftingRequestOf(input, user),
  );

  if (drafted.status !== "ok") {
    return { error: failureOf(drafted), planId: id };
  }

  return { id };
}

// Resolves to an existing plan ID on retry, or creates a fresh plan.
async function planIdOf(
  fullName: string,
  input: NewPlanInput,
  user: PlanUser,
  existingPlanId?: string,
): Promise<{ id: string } | { error: string }> {
  if (existingPlanId) {
    return { id: existingPlanId };
  }

  return freshPlanId(fullName, input, user);
}

async function freshPlanId(
  fullName: string,
  input: NewPlanInput,
  user: PlanUser,
): Promise<{ id: string } | { error: string }> {
  return planRecord(fullName, input, user);
}

async function planRecord(
  fullName: string,
  input: NewPlanInput,
  user: PlanUser,
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

  return { id };
}

function draftingRequestOf(
  { description, storyIssue }: NewPlanInput,
  user: PlanUser,
): DraftingRequest {
  return {
    known: description,
    createdBy: user.id,
    ...(storyIssue ? { storyIssue } : {}),
  };
}

// A valid form from a signed-in person, or what is wrong with it.
async function planRequest(
  formData: FormData,
  fullName: string,
): Promise<{ input: NewPlanInput; user: PlanUser } | { error: string }> {
  const input = newPlanInput(formData, fullName);
  const user = planUserOf((await getSession()) as PlanSession | null);

  if ("error" in input) {
    return input;
  }

  return user ? { input, user } : { error: "Sign in to create a plan." };
}

// What the author already knew becomes the plan's intent, sent whole: the plan reads its Markdown into headings, lists and paragraphs. An empty description leaves the template's own.
async function seedIntent(
  planId: string,
  actor: string,
  description: string,
): Promise<Exclude<ApiResult<unknown>, { status: "ok" }> | null> {
  if (!description) {
    return null;
  }
  const result = await seedPlan(planId, actor, [description]);

  return result.status !== "ok" ? result : null;
}

function failureOf(
  result: Exclude<ApiResult<unknown>, { status: "ok" }>,
): string {
  if (result.status === "unconfigured") {
    return "The plans API is not configured (LORE_API_URL / token).";
  }

  return (
    (result.body as { message?: string } | undefined)?.message ?? result.message
  );
}
