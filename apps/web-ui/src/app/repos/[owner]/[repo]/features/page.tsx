export const dynamic = "force-dynamic";

import { queryAllowMissing } from "@/lib/db";
import type { FeatureRow } from "@/lib/feature-types";
import FeatureListView from "./FeatureListView";

export default async function RepoFeatures({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  // Direct-DB read (queryAllowMissing degrades to [] before migration 0017 lands).
  const features = await queryAllowMissing<FeatureRow>(
    `SELECT * FROM lore.features WHERE repo = $1 ORDER BY updated_at DESC`,
    [fullName],
  );

  return <FeatureListView owner={owner} repo={repo} features={features} />;
}
