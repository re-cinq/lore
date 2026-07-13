export const dynamic = "force-dynamic";
import { query } from "@/lib/db";
import { createOnboardTask } from "@/lib/onboard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import OnboardView from "./OnboardView";

async function onboardRepo(formData: FormData) {
  "use server";
  const fullName = formData.get("full_name") as string;

  if (!fullName?.includes("/")) {
    return;
  }

  const [owner, name] = fullName.split("/");

  // Check if already onboarded
  const existing = await query(
    `SELECT id FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );

  if (existing.length > 0) {
    redirect("/");

    return;
  }

  // Insert into repos table
  await query(
    `INSERT INTO lore.repos (owner, name, full_name) VALUES ($1, $2, $3) ON CONFLICT (full_name) DO NOTHING`,
    [owner, name, fullName],
  );

  await createOnboardTask(fullName);

  revalidatePath("/");
  redirect("/");
}

export default async function OnboardPage() {
  const onboarded = await query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos`,
  );

  return <OnboardView onboarded={onboarded} onboardRepoAction={onboardRepo} />;
}
