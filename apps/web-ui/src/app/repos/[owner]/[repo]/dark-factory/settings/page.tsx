export const dynamic = "force-dynamic";
import { getRepo } from "@/lib/api/repos";
import { revalidatePath } from "next/cache";
import { parsePrivilegedChanges } from "@/lib/settings-form";
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
import {
  repoSettingsOf,
  currentSettingsOf,
  approvalPrFrom,
} from "./page-input";

interface RepoDarkFactoryProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoDarkFactory(props: RepoDarkFactoryProps) {
  const { owner, repo } = await props.params;
  const fullName = `${owner}/${repo}`;
  const repoData = await getRepo(fullName);

  if (repoData.status !== "ok") {
    return <div>Repo not found</div>;
  }
  const { dark_factory: darkFactory } = repoSettingsOf(repoData);
  const resolved = resolveDarkFactorySettings(darkFactory ?? null);

  return (
    <DarkFactoryView
      fullName={fullName}
      resolved={resolved}
      rawImage={darkFactory?.execution?.image}
      defaultExecutionImage={DEFAULT_EXECUTION_IMAGE}
      saveAction={saveDarkFactory}
    />
  );
}

async function saveDarkFactory(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  "use server";
  const fullName = formData.get("full_name") as string;

  const repoRow = await getRepo(fullName);
  const current = currentSettingsOf(repoSettingsOf(repoRow));
  const patch = parsePrivilegedChanges(formData, current, []);

  let privileged: PrivilegedSaveResult | null = null;

  if (!isEmptyPatch(patch)) {
    privileged = await putPrivilegedSettings(
      fullName,
      patch,
      approvalPrFrom(formData),
    );
  }

  revalidatePath(`/repos/${fullName}/dark-factory/settings`);

  return { saved: true, privileged };
}
