"use server";

import { redirect } from "next/navigation";
import { createFeature } from "@/lib/api/features";

// Mutations live here, not inside the page component. A page is a data-fetching
// container; it should not also be where writes are defined and where transport
// failures are turned into user-facing copy.
//
// Identity arrives as LEADING BOUND PARAMETERS — the page calls
// `createFeatureAction.bind(null, fullName)`. Bound arguments are encrypted into
// the client payload, so the repo still comes from the server and never from the
// browser, and the View's prop signature does not change.

export interface CreateFeatureState {
  error?: string;
}

export async function createFeatureAction(
  fullName: string,
  _prev: CreateFeatureState | null,
  formData: FormData,
): Promise<CreateFeatureState> {
  const title = (formData.get("title") as string)?.trim();
  const prompt = (formData.get("prompt") as string)?.trim();

  if (!title || !prompt) {
    return { error: "Title and prompt are required." };
  }
  const result = await createFeature(fullName, title, prompt);

  if (result.status === "ok") {
    redirect(`/repos/${fullName}/features/${result.data.id}`);
  }

  return {
    error:
      result.status === "unconfigured"
        ? "Feature API is not configured (LORE_API_URL / token)."
        : result.message,
  };
}
