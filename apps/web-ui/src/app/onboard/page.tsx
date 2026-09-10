export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import { checkRepoAccess } from "@/lib/github";
import { createOnboardTask } from "@/lib/onboard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import OnboardView, { type OnboardState } from "./OnboardView";

const REPO_SLUG = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export default async function OnboardPage() {
  const repoList = reposOrThrow(await listAllRepos());
  const onboarded = repoList.repos.map((repo) => ({
    full_name: repo.full_name,
  }));

  return <OnboardView onboarded={onboarded} onboardRepoAction={onboardRepo} />;
}

async function onboardRepo(
  _prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  "use server";
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!REPO_SLUG.test(fullName)) {
    return invalidSlugState(fullName);
  }

  const refusal = await attemptOnboarding(fullName);

  if (refusal) {
    return { error: refusal, fullName };
  }

  revalidatePath("/");
  redirect("/");
}

function invalidSlugState(fullName: string): OnboardState {
  return {
    error: `"${fullName}" is not a valid repository — use the owner/name format.`,
    fullName,
  };
}

/** PG errors carry infrastructure detail; the real error is logged and the caller gets a generic message. */
async function attemptOnboarding(fullName: string): Promise<string | null> {
  try {
    return await startOnboarding(fullName);
  } catch (err) {
    console.error(`[onboard] onboarding ${fullName} failed:`, err);

    return `Onboarding ${fullName} failed — check the server logs for details.`;
  }
}

/** Files the onboard task, or says why it did not. Both refusals name the repo and what to check: a repo the App cannot see and one that is already being onboarded look identical from the form, and only the message tells them apart. An existing onboard is REPORTED rather than duplicated — two onboard PRs on one repo is the race this avoids. */
async function startOnboarding(fullName: string): Promise<string | null> {
  if ((await checkRepoAccess(fullName)) === "not-found") {
    return `${fullName} was not found on GitHub — check the owner and repo name, and that the Lore GitHub App has access to it.`;
  }
  const result = await createOnboardTask(fullName);

  return result.ok ? null : result.message;
}
