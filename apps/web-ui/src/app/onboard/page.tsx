export const dynamic = "force-dynamic";
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

  const [owner, name] = fullName.split("/");

  try {
    const existing = await query(
      `SELECT id FROM lore.repos WHERE full_name = $1`,
      [fullName],
    );

    if (existing.length > 0) {
      return { error: `${fullName} is already onboarded.`, fullName };
    }

    if ((await checkRepoAccess(fullName)) === "not-found") {
      return {
        error: `${fullName} was not found on GitHub — check the owner and repo name, and that the Lore GitHub App has access to it.`,
        fullName,
      };
    }

    // Task first, repo row second: if task creation fails, no repos row is
    // left behind to make the retry silently hit the already-onboarded path.
    await createOnboardTask(fullName);
    await query(
      `INSERT INTO lore.repos (owner, name, full_name) VALUES ($1, $2, $3) ON CONFLICT (full_name) DO NOTHING`,
      [owner, name, fullName],
    );
  } catch (err) {
    return {
      error: `Onboarding ${fullName} failed: ${err instanceof Error ? err.message : String(err)}`,
      fullName,
    };
  }

  revalidatePath("/");
  redirect("/");
}

export default async function OnboardPage() {
  const onboarded = await query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos`,
  );

  return <OnboardView onboarded={onboarded} onboardRepoAction={onboardRepo} />;
}
