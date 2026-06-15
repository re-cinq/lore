export const dynamic = "force-dynamic";
import { query, queryOne } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { parseSettingsForm, parsePrivilegedChanges, type CurrentSettings } from '@/lib/settings-form';
import { putPrivilegedSettings, isEmptyPatch, type PrivilegedSaveResult } from '@/lib/mcp-settings';
import { resolveDarkFactorySettings, DEFAULT_EXECUTION_IMAGE } from '@/lib/dark-factory-resolve';
import SettingsView, { type RepoSettingsShape } from './SettingsView';
import type { SaveState } from './SaveResultBanner';

interface Repo { full_name: string }

// Canonical task types (scripts/task-types.yaml) — one override row per type.
const KNOWN_TASK_TYPES = [
  'general', 'implementation', 'review', 'feature-request', 'gap-fill', 'runbook', 'onboard',
];

async function saveSettings(_prev: SaveState, formData: FormData): Promise<SaveState> {
  'use server';
  const fullName = formData.get('full_name') as string;
  const team = formData.get('team') as string;

  // General (non-privileged) → direct DB, shallow-merged into settings JSONB.
  const updates = parseSettingsForm(formData);
  const selectedRepos = updates.cross_repo_repos as string[];
  await query(
    `UPDATE lore.repos SET team = $1, settings = COALESCE(settings, '{}') || $2::jsonb WHERE full_name = $3`,
    [team || null, JSON.stringify(updates), fullName],
  );

  // Bidirectional cross-repo linkage: add this repo to each linked repo's list.
  for (const linkedRepo of selectedRepos) {
    await query(
      `UPDATE lore.repos
       SET settings = jsonb_set(
         jsonb_set(COALESCE(settings, '{}'), '{cross_repo}', 'true'),
         '{cross_repo_repos}',
         (SELECT COALESCE(jsonb_agg(DISTINCT val), '[]') FROM (
           SELECT val FROM jsonb_array_elements_text(COALESCE(settings->'cross_repo_repos', '[]')) val
           UNION SELECT $1
         ) sub)
       )
       WHERE full_name = $2`,
      [fullName, linkedRepo],
    );
  }

  // Privileged (dark_factory + task_overrides) → diff against the resolved
  // current settings (so untouched defaults don't spuriously trip the two-key
  // gate) and route changes through the gated mcp API.
  const repoRow = await queryOne<{ settings: RepoSettingsShape }>(
    `SELECT settings FROM lore.repos WHERE full_name = $1`, [fullName],
  );
  const cur = (repoRow?.settings ?? {}) as RepoSettingsShape;
  const resolved = resolveDarkFactorySettings(cur.dark_factory ?? null);
  const current: CurrentSettings = {
    dark_factory: { ...resolved, execution: cur.dark_factory?.execution },
    task_overrides: cur.task_overrides,
  };
  const patch = parsePrivilegedChanges(formData, current, KNOWN_TASK_TYPES);

  let privileged: PrivilegedSaveResult | null = null;
  if (!isEmptyPatch(patch)) {
    const approvalPr = (formData.get('approval_pr') as string || '').trim() || undefined;
    privileged = await putPrivilegedSettings(fullName, patch, approvalPr);
  }

  revalidatePath(`/repos/${fullName}/settings`);
  return { saved: true, privileged };
}

export default async function RepoSettings({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await queryOne<{ team: string | null; settings: RepoSettingsShape | null }>(
    `SELECT team, settings FROM lore.repos WHERE full_name = $1`, [fullName],
  );
  if (!repoData) return <div>Repo not found</div>;
  const settings = repoData.settings ?? {};
  const resolved = resolveDarkFactorySettings(settings.dark_factory ?? null);

  const allRepos = await query<Repo>(
    `SELECT full_name FROM lore.repos WHERE full_name != $1 ORDER BY full_name`, [fullName],
  );

  return (
    <SettingsView
      fullName={fullName}
      team={repoData.team ?? ''}
      settings={settings}
      resolved={resolved}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      allRepos={allRepos}
      knownTaskTypes={KNOWN_TASK_TYPES}
      saveAction={saveSettings}
    />
  );
}
