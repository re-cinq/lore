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

export async function handleCreateSpecFile(
  fullName: string,
  id: string,
  userAnswers: SectionAnswers,
): Promise<void> {
  enforceOk(
    "Creating the spec file",
    await createSpecFile(fullName, id, userAnswers),
  );
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
