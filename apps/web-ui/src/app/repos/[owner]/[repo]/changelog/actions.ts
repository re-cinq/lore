"use server";

import { writeChangelogIntro } from "@/lib/api/changelog";

/** Starts a finished week's introduction again (specs/repo-changelog FR6) and answers the line the button shows: the run writes it in about a minute, so the page is not revalidated here. */
export async function writeIntroAction(
  repo: string,
  week: string,
): Promise<string> {
  const result = await writeChangelogIntro(repo, week);

  if (result.status === "ok") {
    return "Writing the introduction: reload in a minute or two.";
  }

  return `Could not start the introduction: ${
    result.status === "error" ? result.message : "Lore API unconfigured"
  }.`;
}
