export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import { checkRepoAccess } from "@/lib/github";
import { createOnboardTask } from "@/lib/onboard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import OnboardView, { type OnboardState } from "./OnboardView";

const REPO_SLUG = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

async function onboardRepo(
  _prev: OnboardState,
  formData: FormData,
): Promise<OnboardState> {
  "use server";
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!REPO_SLUG.test(fullName)) {
    return {
      error: `"${fullName}" is not a valid repository — use the owner/name format.`,
      fullName,
    };
  }

  try {
    if ((await checkRepoAccess(fullName)) === "not-found") {
      return {
        error: `${fullName} was not found on GitHub — check the owner and repo name, and that the Lore GitHub App has access to it.`,
        fullName,
      };
    }

    const result = await createOnboardTask(fullName);

    // Report existing onboard/PR/task instead of filing duplicate (avoid race).
    if (!result.ok) {
      return { error: result.message, fullName };
    }
  } catch (err) {
    // PG errors carry infrastructure detail; log real error, return generic message.
    console.error(`[onboard] onboarding ${fullName} failed:`, err);

    return {
      error: `Onboarding ${fullName} failed — check the server logs for details.`,
      fullName,
    };
  }

  revalidatePath("/");
  redirect("/");
}

export default async function OnboardPage() {
  const repoList = reposOrThrow(await listAllRepos());
  const onboarded = repoList.repos.map((repo) => ({
    full_name: repo.full_name,
  }));

  return <OnboardView onboarded={onboarded} onboardRepoAction={onboardRepo} />;
}
