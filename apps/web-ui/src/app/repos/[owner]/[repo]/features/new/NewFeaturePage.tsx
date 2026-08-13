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

  // Fetched here, not in the view: the Floor owns the YAML, and a preview that
  // needs a web-ui rebuild to catch up would defeat the point.
  const definition = await getAssemblyLineDefinition("feature-planning");

  return (
    <SmartFeatureCreateView
      action={createFeatureAction.bind(null, fullName)}
      definition={definition}
    />
  );
}
