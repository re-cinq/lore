export const dynamic = "force-dynamic";
import { listRepos } from "@/lib/api/repos";
import { query } from "@/lib/db";
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

    // Already onboarded / PR still open / task in flight: report it instead of
    // filing a duplicate task, which would open its own Issue and race its own
    // PR against the one already in progress.
    if (!result.ok) {
      return { error: result.message, fullName };
    }
  } catch (err) {
    // pg errors carry infrastructure detail (hosts, users) that an onboarding
    // form must not disclose — log the real error, return a generic message.
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
  const repoList = await listRepos();
  const onboarded =
    repoList.status === "ok"
      ? repoList.data.repos.map((repo) => ({ full_name: repo.full_name }))
      : [];

  return <OnboardView onboarded={onboarded} onboardRepoAction={onboardRepo} />;
}
