// The spec writer gets 30 minutes: the repair visit works a plan's whole coverage list alone and was killed at 15.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updateTimeout }) => {
  await updateTimeout("spec-write", "spec-write.md");
};
