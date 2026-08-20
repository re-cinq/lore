export const dynamic = "force-dynamic";
import { getRepo, listAllRepos, putRepoSettings } from "@/lib/api/repos";
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

  await putRepoSettings(fullName, { team: team || null, settings: updates });

  // Bidirectional cross-repo linkage: add this repo to each linked repo's list.
  for (const linkedRepo of selectedRepos) {
    const linked = await getRepo(linkedRepo);
    const current =
      (linked.status === "ok" ? linked.data.settings : null) ?? {};
    const existing = Array.isArray(current.cross_repo_repos)
      ? (current.cross_repo_repos as string[])
      : [];

    await putRepoSettings(linkedRepo, {
      settings: {
        cross_repo: true,
        cross_repo_repos: [...new Set([...existing, fullName])],
      },
    });
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
  const record = await getRepo(fullName);

  if (record.status !== "ok") {
    return <div>Repo not found</div>;
  }
  const repoData = {
    team: record.data.team,
    settings: record.data.settings as RepoSettingsShape | null,
  };

  const repoList = await listAllRepos();

  if (repoList.status !== "ok") {
    // An unreachable lore-api used to throw here, before these reads moved
    // behind it. Answering `[]` instead renders "no repos" — a degraded
    // dependency reported as legitimate empty data (#1427).
    throw new Error(
      `repo list unavailable: ${repoList.status === "error" ? repoList.message : "LORE_API_URL not configured"}`,
    );
  }
  const allRepos: Repo[] = repoList.data.repos
    .filter((r) => r.full_name !== fullName)
    .map((r) => ({ full_name: r.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

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
