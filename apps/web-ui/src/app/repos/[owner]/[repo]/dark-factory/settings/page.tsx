export const dynamic = "force-dynamic";
import { queryOne } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { parsePrivilegedChanges, type CurrentSettings } from '@/lib/settings-form';
import { putPrivilegedSettings, isEmptyPatch, type PrivilegedSaveResult } from '@/lib/mcp-settings';
import { resolveDarkFactorySettings, DEFAULT_EXECUTION_IMAGE } from '@/lib/dark-factory-resolve';
import DarkFactoryView from './DarkFactoryView';
import type { SaveState } from '../../settings/SaveResultBanner';

interface RepoSettings {
  dark_factory?: { execution?: { image?: string; backend?: string } };
}

async function saveDarkFactory(_prev: SaveState, formData: FormData): Promise<SaveState> {
  'use server';
  const fullName = formData.get('full_name') as string;

  const repoRow = await queryOne<{ settings: RepoSettings }>(
    `SELECT settings FROM lore.repos WHERE full_name = $1`, [fullName],
  );
  const cur = (repoRow?.settings ?? {}) as RepoSettings;
  const resolved = resolveDarkFactorySettings(cur.dark_factory ?? null);
  const current: CurrentSettings = {
    dark_factory: { ...resolved, execution: cur.dark_factory?.execution },
  };
  const patch = parsePrivilegedChanges(formData, current, []);

  let privileged: PrivilegedSaveResult | null = null;
  if (!isEmptyPatch(patch)) {
    const approvalPr = (formData.get('approval_pr') as string || '').trim() || undefined;
    privileged = await putPrivilegedSettings(fullName, patch, approvalPr);
  }

  revalidatePath(`/repos/${fullName}/dark-factory/settings`);
  return { saved: true, privileged };
}

export default async function RepoDarkFactory({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await queryOne<{ settings: RepoSettings | null }>(
    `SELECT settings FROM lore.repos WHERE full_name = $1`, [fullName],
  );
  if (!repoData) return <div>Repo not found</div>;
  const settings = repoData.settings ?? {};
  const resolved = resolveDarkFactorySettings(settings.dark_factory ?? null);

  return (
    <DarkFactoryView
      fullName={fullName}
      resolved={resolved}
      rawImage={settings.dark_factory?.execution?.image}
      rawBackend={settings.dark_factory?.execution?.backend}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      saveAction={saveDarkFactory}
    />
  );
}
