// The planning agent leaves the Prototype section to the sketch agent; the spec and ticket writers carry its sketches into the repository.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("plan-analyze", "plan-analyze.md");
  await updatePrompt("spec-draft", "spec-draft.md");
  await updatePrompt("spec-rework", "spec-rework.md");
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
