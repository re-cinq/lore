import { redirect } from "next/navigation";
import { createFeature } from "@/lib/feature-api";
import SmartFeatureCreateView from "./SmartFeatureCreateView";

export default async function NewFeature({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  async function create(
    _prev: { error?: string } | null,
    formData: FormData,
  ): Promise<{ error?: string }> {
    "use server";
    const title = (formData.get("title") as string)?.trim();
    const prompt = (formData.get("prompt") as string)?.trim();
    if (!title || !prompt) return { error: "Title and prompt are required." };
    const result = await createFeature(fullName, title, prompt);
    if (result.status === "ok") {
      redirect(`/repos/${owner}/${repo}/features/${result.data.id}`);
    }
    return {
      error:
        result.status === "unconfigured"
          ? "Feature API is not configured (LORE_API_URL / token)."
          : result.message,
    };
  }

  return <SmartFeatureCreateView action={create} />;
}
