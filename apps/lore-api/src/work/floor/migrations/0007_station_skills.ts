// Stations get the skills that match their job, after the skills catalogue was trimmed.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updateSkills }) => {
  await updateSkills("loop-tdd-round", "loop-tdd-round.md");
  await updateSkills("loop-dod", "loop-dod.md");
  await updateSkills("loop-fix-ci", "loop-fix-ci.md");
  await updateSkills("code-review", "code-review.md");
  await updateSkills("code-review-recheck", "code-review-recheck.md");
  await updateSkills("triage-reproduce", "triage-reproduce.md");
  await updateSkills("plan-analyze", "plan-analyze.md");
};
