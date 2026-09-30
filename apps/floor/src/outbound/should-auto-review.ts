import { autoReviewEnabled } from "@re-cinq/lore-shared/review/code-review-decisions.js";
import { settings } from "./queues.js";

export async function shouldAutoReview(repo: string): Promise<boolean> {
  return autoReviewEnabled(await settings().rawSettings(repo));
}
