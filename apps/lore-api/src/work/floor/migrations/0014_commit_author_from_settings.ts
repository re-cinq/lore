// The commit author moved out of six prompts into the GIT_AUTHOR_* / GIT_COMMITTER_* env of their config (LORE_COMMIT_AUTHOR_NAME / _EMAIL, the chart's commitAuthor).
import type { FloorMigration } from "../floor-migrations.js";

const COMMITTING_AGENTS = [
  "gap-fill",
  "loop-dod",
  "loop-fix-ci",
  "loop-tdd-round",
  "spec-draft",
  "spec-rework",
];

export const migrate: FloorMigration = async ({ updatePrompt, updateEnv }) => {
  for (const agent of COMMITTING_AGENTS) {
    await updatePrompt(agent, `${agent}.md`);
    await updateEnv(agent, `${agent}.md`);
  }
};
