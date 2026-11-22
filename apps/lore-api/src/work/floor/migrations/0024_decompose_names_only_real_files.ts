// spec-tickets filed a ticket whose target file and test path did not exist (re-cinq/lore-security#71), so the loop could not start it. The decompose prompt now says a task names only files on the branch or files it says it adds, and puts tests where CI runs them.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
