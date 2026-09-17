"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  refineFeature,
  createSpecFile,
  splitFeature,
  deleteFeature,
} from "@/lib/api/features";
import { enforceOk } from "@/lib/api/result";
import type { SectionAnswers } from "@/lib/feature-types";

// Lifecycle mutations; bound args encrypted into payload so repo/id come from server; all enforce result.
// A lore-api refusal (4xx) is returned as a string so the client can show it as error state; a
// fault (5xx / unreachable) still throws and becomes a Next.js error boundary.
export async function refineFeatureAction(
  fullName: string,
  id: string,
  userAnswers: SectionAnswers,
  fromIteration?: number,
): Promise<string | void> {
  const result = enforceOk(
    "Starting a planning round",
    await refineFeature(fullName, id, userAnswers, fromIteration),
  );
  if (typeof result === "string") return result;
  revalidatePath(`/repos/${fullName}/features/${id}`);
}

export async function handleCreateSpecFile(
  fullName: string,
  id: string,
  userAnswers: SectionAnswers,
): Promise<string | void> {
  const result = enforceOk(
    "Creating the spec file",
    await createSpecFile(fullName, id, userAnswers),
  );
  if (typeof result === "string") return result;
  revalidatePath(`/repos/${fullName}/features/${id}`);
}

export async function splitFeatureAction(
  fullName: string,
  id: string,
  title: string,
  prompt: string,
): Promise<string | void> {
  const result = enforceOk(
    "Splitting the feature",
    await splitFeature(fullName, id, title, prompt),
  );
  if (typeof result === "string") return result;
  revalidatePath(`/repos/${fullName}/features`);
}

export async function deleteFeatureAction(
  fullName: string,
  id: string,
): Promise<string | void> {
  const result = enforceOk(
    "Deleting the feature",
    await deleteFeature(fullName, id),
  );
  if (typeof result === "string") return result;
  revalidatePath(`/repos/${fullName}/features`);
  redirect(`/repos/${fullName}/features`);
}
