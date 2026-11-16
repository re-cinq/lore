// A Refine acts on where a resolved thread ends; the sketch agent may write the section a thread on Prototype asks for.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("plan-sketch", "plan-sketch.md");
  await updatePrompt("plan-analyze", "plan-analyze.md");
};
