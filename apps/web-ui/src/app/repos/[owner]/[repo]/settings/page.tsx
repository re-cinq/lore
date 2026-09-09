export const dynamic = "force-dynamic";
import {
  getRepo,
  listAllRepos,
  reposOrThrow,
  putRepoSettings,
} from "@/lib/api/repos";
import { revalidatePath } from "next/cache";
import { parseSettingsForm } from "@/lib/settings-form";
import SettingsView, { type RepoSettingsShape } from "./SettingsView";
import type { SaveState } from "./SaveResultBanner";

interface Repo {
  full_name: string;
}

// Bidirectional cross-repo linkage: add this repo to the linked repo's own list.
async function linkBack(fullName: string, linkedRepo: string) {
  const linked = await getRepo(linkedRepo);
  const current = (linked.status === "ok" ? linked.data.settings : null) ?? {};
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

async function saveSettings(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  "use server";
  const fullName = formData.get("full_name") as string;
  const team = formData.get("team") as string;

  // General → direct DB; dark-factory (privileged) on Dark Factory tab; agents on Agents tab.
  const updates = parseSettingsForm(formData);
  const selectedRepos = updates.cross_repo_repos as string[];

  await putRepoSettings(fullName, { team: team || null, settings: updates });
  await Promise.all(
    selectedRepos.map((linkedRepo) => linkBack(fullName, linkedRepo)),
  );

  revalidatePath(`/repos/${fullName}/settings`);

  return { saved: true, privileged: null };
}

/** Every other onboarded repo, alphabetised — the candidates for a cross-repo link. */
function linkCandidates(repos: Repo[], fullName: string): Repo[] {
  const others = repos.filter((repo) => repo.full_name !== fullName);

  return others
    .map((repo) => ({ full_name: repo.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

interface RepoSettingsProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoSettings(props: RepoSettingsProps) {
  const { owner, repo } = await props.params;
  const fullName = `${owner}/${repo}`;
  const record = await getRepo(fullName);

  if (record.status !== "ok") {
    return <div>Repo not found</div>;
  }
  const { team, settings } = record.data;
  const { repos } = reposOrThrow(await listAllRepos());

  return (
    <SettingsView
      fullName={fullName}
      team={team ?? ""}
      settings={(settings as RepoSettingsShape | null) ?? {}}
      allRepos={linkCandidates(repos, fullName)}
      saveAction={saveSettings}
    />
  );
}
