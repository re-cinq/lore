"use server";

import { revalidatePath } from "next/cache";
import { deleteAgent, type AgentSaveResult } from "@/lib/agents-api";

/** Throws unless the delete landed, mirroring `enforceOk` for the agents union: a swallowed refusal would refresh the tab and leave the override in place, which reads exactly like success. */
function enforceRemoved(action: string, result: AgentSaveResult): void {
  if (result.status === "ok") {
    return;
  }

  if (result.status === "unconfigured") {
    throw new Error(
      `${action} is unavailable: the web UI has no LORE_API_URL plus LORE_ADMIN_TOKEN or LORE_INGEST_TOKEN configured.`,
    );
  }

  throw new Error(
    `${action} failed: ${
      result.status === "error" ? result.message : result.detail
    }`,
  );
}

/** Drops this repo's project definition so the org-wide default resolves again. The repo is bound server-side; the browser only names the definition. */
export async function removeAgentOverrideAction(
  repo: string,
  name: string,
): Promise<void> {
  enforceRemoved("remove agent override", await deleteAgent(repo, name));
  revalidatePath(`/repos/${repo}/agents`);
}
