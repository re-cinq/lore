// Strips hardcoded git identity lines from agent prompts; author identity moved to Helm values in T001.
import type { FloorMigration } from "../floor-migrations.js";

const AUTHOR_BLOCK =
  "- Configure your git identity before committing: `git config --global user.name 'Lore Agent'` and `git config --global user.email 'lore-agent@re-cinq.com'`.\n";

export const migrate: FloorMigration = async (floor) => {
  await floor.stripFromPrompts(AUTHOR_BLOCK);
};
