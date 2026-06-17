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
  const latestIteration = iterations[0] ?? null;
  // Surface the underlying task's status/failure so the wizard can show a failure
  // + retry even when a hard crash left the iteration stuck at 'running'.
  let task: { status: string; failure_reason: string | null } | null = null;
  if (latestIteration?.task_id) {
    const tasks = await queryAllowMissing<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM pipeline.tasks WHERE id = $1`,
      [latestIteration.task_id],
    );
    task = tasks[0] ?? null;
  }
  return NextResponse.json({ feature, latestIteration, task });
}
