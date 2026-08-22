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

// The feature's lifecycle mutations. Identity arrives as LEADING BOUND
// PARAMETERS, so the page writes `refineFeatureAction.bind(null, fullName, id)`
// and the View's prop signature is unchanged — it still receives
// `refine(answers, fromIteration?)`.
//
// Bound arguments are encrypted into the client payload, so repo and feature id
// come from the server and never from the browser.
//
// Every one enforces its result. `apiFetch` reports failure in the RETURN VALUE,
// so an action that ignored it would resolve normally: the browser is told 200,
// nothing was written, and it is indistinguishable from a no-op refresh.

export async function refineFeatureAction(
  fullName: string,
  id: string,
  userAnswers: SectionAnswers,
  fromIteration?: number,
): Promise<void> {
  enforceOk(
    "Starting a planning round",
    await refineFeature(fullName, id, userAnswers, fromIteration),
  );
  revalidatePath(`/repos/${fullName}/features/${id}`);
}

/// TODO: this handler must take the form answers and send them to the server
/// to be added to the context.
export async function handleCreateSpecFile(
  fullName: string,
  id: string,
): Promise<void> {
  enforceOk("Creating the spec file", await createSpecFile(fullName, id));
  revalidatePath(`/repos/${fullName}/features/${id}`);
}

export async function splitFeatureAction(
  fullName: string,
  id: string,
  title: string,
  prompt: string,
): Promise<void> {
  enforceOk(
    "Splitting the feature",
    await splitFeature(fullName, id, title, prompt),
  );
  revalidatePath(`/repos/${fullName}/features`);
}

export async function deleteFeatureAction(
  fullName: string,
  id: string,
): Promise<void> {
  enforceOk("Deleting the feature", await deleteFeature(fullName, id));
  revalidatePath(`/repos/${fullName}/features`);
  redirect(`/repos/${fullName}/features`);
}
