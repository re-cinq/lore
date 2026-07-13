export const dynamic = "force-dynamic";
import { query, queryOne } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { parseSettingsForm } from "@/lib/settings-form";
import SettingsView, { type RepoSettingsShape } from "./SettingsView";
import type { SaveState } from "./SaveResultBanner";

interface Repo {
  full_name: string;
}

async function saveSettings(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  "use server";
  const fullName = formData.get("full_name") as string;
  const team = formData.get("team") as string;

  // General (non-privileged) → direct DB, shallow-merged into settings JSONB.
  // Dark-factory (privileged) lives on the Dark Factory tab; agents on the Agents tab.
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

  revalidatePath(`/repos/${fullName}/settings`);
  return { saved: true, privileged: null };
}

export default async function RepoSettings({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await queryOne<{
    team: string | null;
    settings: RepoSettingsShape | null;
  }>(`SELECT team, settings FROM lore.repos WHERE full_name = $1`, [fullName]);
  if (!repoData) return <div>Repo not found</div>;

  const allRepos = await query<Repo>(
    `SELECT full_name FROM lore.repos WHERE full_name != $1 ORDER BY full_name`,
    [fullName],
  );

  return (
    <SettingsView
      fullName={fullName}
      team={repoData.team ?? ""}
      settings={repoData.settings ?? {}}
      allRepos={allRepos}
      saveAction={saveSettings}
    />
  );
}
