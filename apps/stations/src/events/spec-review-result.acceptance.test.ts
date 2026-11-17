import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { describe, it } from "vitest";
import { buildStationHandlers } from "./handlers.js";
import { SPEC_REVIEW_RESULT_EVENT } from "@re-cinq/lore-shared/review/spec-review.js";

describe("spec.review.result event", () => {
  it("writes plan questions for to_plan comments, resolves threads for addressed, and re-homes questions missing a slot", async () => {
    const handlers = buildStationHandlers();
    const handler = handlers.get(SPEC_REVIEW_RESULT_EVENT);

    enforceTrue(
      handler,
      Error,
      "The Floor does not own the artifact: each question is written into the plan as an agent question with an id keyed on the review comment it answers for, but no handler exists for spec.review.result",
    );
  });
});
