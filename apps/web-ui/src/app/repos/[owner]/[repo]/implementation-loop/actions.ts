"use server";

import { revalidatePath } from "next/cache";
import { setImplementationLoopEnabled } from "@/lib/api/backlog";
import { enforceOk } from "@/lib/api/result";

/** Flip repo's backlog loop; repo identity from server via bound parameter, never browser. */
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
