"use server";

import { revalidatePath } from "next/cache";
import { setImplementationLoopEnabled } from "@/lib/api/backlog";
import { enforceOk } from "@/lib/api/result";

/** Flip the repo's backlog loop. Identity is a LEADING BOUND PARAMETER — the
 *  page writes `toggleImplementationLoopAction.bind(null, fullName)`, so the
 *  repo comes from the server, never from the browser. */
export async function toggleImplementationLoopAction(
  fullName: string,
  enabled: boolean,
): Promise<void> {
  enforceOk(
    "toggle implementation loop",
    await setImplementationLoopEnabled(fullName, enabled),
  );
  const [owner, repo] = fullName.split("/");

  revalidatePath(`/repos/${owner}/${repo}/implementation-loop`);
}
