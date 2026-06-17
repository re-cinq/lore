export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { queryAllowMissing } from '@/lib/db';
import type { FeatureRow, FeatureIterationRow } from '@/lib/feature-types';

// Client-poll endpoint for the planning wizard: returns the feature + its latest
// iteration (status + gap_result) read direct-DB. The wizard polls this while a
// round is running. See specs/7-feature-planning/ and ADR-027.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string; repo: string; id: string }> },
) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  const features = await queryAllowMissing<FeatureRow>(
    `SELECT * FROM lore.features WHERE id = $1 AND repo = $2`,
    [id, fullName],
  );
  const feature = features[0] ?? null;
  if (!feature) {
    return NextResponse.json({ error: 'feature not found' }, { status: 404 });
  }
  const iterations = await queryAllowMissing<FeatureIterationRow>(
    `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 ORDER BY iteration DESC LIMIT 1`,
    [id],
  );
  return NextResponse.json({ feature, latestIteration: iterations[0] ?? null });
}
