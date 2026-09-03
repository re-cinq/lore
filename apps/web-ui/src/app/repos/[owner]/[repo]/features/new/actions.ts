"use server";

import { redirect } from "next/navigation";
import { createFeature } from "@/lib/api/features";

// Mutations here (not in page); bound args encrypted into payload so repo comes from server.
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
