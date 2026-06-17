export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { queryAllowMissing } from '@/lib/db';
import { refineFeature, finalizeFeature, splitFeature } from '@/lib/feature-api';
import type { FeatureRow, FeatureIterationRow, FeatureWithIterations } from '@/lib/feature-types';
import FeatureDetailView from './FeatureDetailView';

export default async function FeatureDetail({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;

  const features = await queryAllowMissing<FeatureRow>(
    `SELECT * FROM lore.features WHERE id = $1 AND repo = $2`,
    [id, fullName],
  );
  const feature = features[0];
  if (!feature) {
    return (
      <div className="spec-card">
        <p className="meta">Feature not found.</p>
      </div>
    );
  }
  const iterations = await queryAllowMissing<FeatureIterationRow>(
    `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 ORDER BY iteration ASC`,
    [id],
  );
  const full: FeatureWithIterations = { ...feature, iterations };

  async function refine(userAnswers: unknown) {
    'use server';
    await refineFeature(fullName, id, userAnswers);
    revalidatePath(`/repos/${owner}/${repo}/features/${id}`);
  }
  async function finalize() {
    'use server';
    await finalizeFeature(fullName, id);
    revalidatePath(`/repos/${owner}/${repo}/features/${id}`);
  }
  async function split(title: string, prompt: string) {
    'use server';
    await splitFeature(fullName, id, title, prompt);
    revalidatePath(`/repos/${owner}/${repo}/features`);
  }

  return (
    <FeatureDetailView
      owner={owner}
      repo={repo}
      feature={full}
      refine={refine}
      finalize={finalize}
      split={split}
    />
  );
}
