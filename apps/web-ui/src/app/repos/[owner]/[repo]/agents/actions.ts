"use server";

import { revalidatePath } from "next/cache";
import { deleteAgent, type AgentSaveResult } from "@/lib/agents-api";
import { putRepoSettings } from "@/lib/api/repos";
import { enforceOk } from "@/lib/api/result";

/** Saves or clears the repo-level base execution image through repo settings and refreshes the Agents and Settings tabs. */
export async function saveBaseImageAction(
  repo: string,
  formData: FormData,
): Promise<void> {
  const raw = ((formData.get("base_image") as string) || "").trim();

  enforceOk(
    "save base image",
    await putRepoSettings(repo, { settings: { base_image: raw || null } }),
  );
  revalidatePath(`/repos/${repo}/agents`);
  revalidatePath(`/repos/${repo}/settings`);
}

/** Drops this repo's project definition so the org-wide default resolves again. The repo is bound server-side; the browser only names the definition. */
export async function removeAgentOverrideAction(
  repo: string,
  name: string,
): Promise<void> {
  enforceRemoved("remove agent override", await deleteAgent(repo, name));
  revalidatePath(`/repos/${repo}/agents`);
}

/** Throws unless the delete landed, mirroring `enforceOk` for the agents union: a swallowed refusal would refresh the tab and leave the override in place, which reads exactly like success. */
function enforceRemoved(action: string, result: AgentSaveResult): void {
  if (result.status === "ok") {
    return;
  }

  if (result.status === "unconfigured") {
    throw new Error(
      `${action} is unavailable: the web UI has no LORE_API_URL set or no signed-in session.`,
    );
  }

  throw new Error(
    `${action} failed: ${
      result.status === "error" ? result.message : result.detail
    }`,
  );
}
