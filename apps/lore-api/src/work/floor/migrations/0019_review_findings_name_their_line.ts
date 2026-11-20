// Every five-pass finding names its line, so it is posted as a comment on that line, and what is correct stays out of the findings.
import type { FloorMigration } from "../floor-migrations.js";

const FINDING_AGENTS = [
  "shadow-compare-intent",
  "shadow-review-product",
  "code-review-product",
];

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  for (const agent of FINDING_AGENTS) {
    await updatePrompt(agent, `${agent}.md`);
  }
};
