import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import SmartFeatureCreateView from "./SmartFeatureCreateView";
import { createFeatureAction } from "./actions";

export default async function NewFeaturePage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  // Fetched here (Floor owns YAML); preview needing rebuild would defeat the point.
  const definition = await getAssemblyLineDefinition("feature-planning");

  return (
    <SmartFeatureCreateView
      action={createFeatureAction.bind(null, fullName)}
      definition={definition}
    />
  );
}
