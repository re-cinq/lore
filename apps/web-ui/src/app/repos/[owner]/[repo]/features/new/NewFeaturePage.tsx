import { redirect } from "next/navigation";
import { createFeature } from "@/lib/feature-api";
import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import SmartFeatureCreateView from "./SmartFeatureCreateView";

export default async function NewFeaturePage({
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

    if (!title || !prompt) {
      return { error: "Title and prompt are required." };
    }
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

  // Fetched here, not in the view: the Floor owns the YAML, and a preview that
  // needs a web-ui rebuild to catch up would defeat the point.
  const definition = await getAssemblyLineDefinition("feature-planning");

  return <SmartFeatureCreateView action={create} definition={definition} />;
}
