export const dynamic = "force-dynamic";
import { getRepo } from "@/lib/api/repos";
import { revalidatePath } from "next/cache";
import {
  parsePrivilegedChanges,
  type CurrentSettings,
} from "@/lib/settings-form";
import {
  putPrivilegedSettings,
  isEmptyPatch,
  type PrivilegedSaveResult,
} from "@/lib/mcp-settings";
import {
  resolveDarkFactorySettings,
  DEFAULT_EXECUTION_IMAGE,
} from "@/lib/dark-factory-resolve";
import DarkFactoryView from "./DarkFactoryView";
import type { SaveState } from "../../settings/SaveResultBanner";

interface RepoSettings {
  dark_factory?: { execution?: { image?: string } };
}

async function saveDarkFactory(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  "use server";
  const fullName = formData.get("full_name") as string;

  const repoRow = await getRepo(fullName);
  const cur = (
    repoRow.status === "ok" ? (repoRow.data.settings ?? {}) : {}
  ) as RepoSettings;
  const resolved = resolveDarkFactorySettings(cur.dark_factory ?? null);
  const current: CurrentSettings = {
    dark_factory: { ...resolved, execution: cur.dark_factory?.execution },
  };
  const patch = parsePrivilegedChanges(formData, current, []);

  let privileged: PrivilegedSaveResult | null = null;

  if (!isEmptyPatch(patch)) {
    const approvalPr =
      ((formData.get("approval_pr") as string) || "").trim() || undefined;

    privileged = await putPrivilegedSettings(fullName, patch, approvalPr);
  }

  revalidatePath(`/repos/${fullName}/dark-factory/settings`);

  return { saved: true, privileged };
}

export default async function RepoDarkFactory({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const repoData = await getRepo(fullName);

  if (repoData.status !== "ok") {
    return <div>Repo not found</div>;
  }
  const settings = (repoData.data.settings ?? {}) as RepoSettings;
  const resolved = resolveDarkFactorySettings(settings.dark_factory ?? null);

  return (
    <DarkFactoryView
      fullName={fullName}
      resolved={resolved}
      rawImage={settings.dark_factory?.execution?.image}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      saveAction={saveDarkFactory}
    />
  );
}
