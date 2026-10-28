// Gate for log/timeline proxy routes: whether the signed-in person may open a repo, answered by lore-api from the list GitHub gave it at sign-in (ADR-053).
import { repoAccess } from "@/lib/api/auth";

export async function userCanAccessRepo(repo: string): Promise<boolean> {
  const result = await repoAccess(repo);
  const allowed = result.status === "ok" && result.data.allowed;

  if (!allowed) {
    console.warn(`[repo-access] denied ${repo}: ${reasonOf(result)}`);
  }

  return allowed;
}

/** Why access was denied, for the operator's log: never a token, only what lore-api answered. */
function reasonOf(result: Awaited<ReturnType<typeof repoAccess>>): string {
  if (result.status === "ok") {
    return "the repo is not in the person's list from sign-in";
  }

  return result.status === "error"
    ? `lore-api answered ${result.code ?? "nothing"}: ${result.message}`
    : "lore-api is not configured";
}
