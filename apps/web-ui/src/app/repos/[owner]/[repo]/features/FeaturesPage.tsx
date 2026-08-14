import { listFeatures } from "@/lib/api/features";
import FeatureListView from "./FeatureListView";

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const result = await listFeatures(fullName);
  const features = result.status === "ok" ? result.data.features : [];

  return <FeatureListView owner={owner} repo={repo} features={features} />;
}
