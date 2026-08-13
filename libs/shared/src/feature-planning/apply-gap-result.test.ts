import { describe, it, expect } from "vitest";
import { InMemoryFeatures } from "../project/features/features-memory.js";
import { Features } from "../project/features/features.js";
import { applyGapResult } from "./apply-gap-result.js";

const REPO = "re-cinq/lore";

const gap = {
  sections: [
    { title: "Overview", body: "A live view over the AssemblyLines." },
  ],
  draft_spec_markdown: "# Assembly lines live view",
};

async function featureWithRound() {
  const features = new Features(REPO, new InMemoryFeatures());
  const feature = await features.create({
    title: "Assembly lines live view",
    prompt: "a live view over the AssemblyLines",
  });

  await features.appendIteration(feature.id, null);

  return { features, id: feature.id };
}

describe("applyGapResult", () => {
  it("marks the round ready and stores the gap for a valid payload", async () => {
    const { features, id } = await featureWithRound();

    expect(await applyGapResult(features, id, 1, gap)).toEqual({
      outcome: "ready",
    });

    const feature = await features.get(id);

    expect(feature?.iterations[0]).toMatchObject({ status: "ready" });
    expect(feature?.iterations[0].gap_result).toBeTruthy();
  });

  it("advances the feature out of planning and keeps the draft spec", async () => {
    const { features, id } = await featureWithRound();

    await applyGapResult(features, id, 1, gap);

    const feature = await features.get(id);

    expect(feature?.status).not.toBe("planning");
    expect(feature?.draft_spec_md).toBe("# Assembly lines live view");
  });

  it("fails the round and reports why for a payload that does not validate", async () => {
    const { features, id } = await featureWithRound();
    const result = await applyGapResult(features, id, 1, { nope: true });

    expect(result.outcome).toBe("failed");
    expect(result).toHaveProperty("error");
    expect((await features.get(id))?.iterations[0]).toMatchObject({
      status: "failed",
      gap_result: null,
    });
  });

  it("reports a missing feature without touching anything", async () => {
    const features = new Features(REPO, new InMemoryFeatures());

    expect(
      await applyGapResult(
        features,
        "00000000-0000-0000-0000-000000000000",
        1,
        gap,
      ),
    ).toEqual({ outcome: "failed", error: "feature not found" });
  });

  it("records a late result without dragging a finalized feature back into planning", async () => {
    const { features, id } = await featureWithRound();

    await features.transitionStatus(id, "pr-open");
    await applyGapResult(features, id, 1, gap);

    const feature = await features.get(id);

    expect(feature?.status).toBe("pr-open");
    expect(feature?.iterations[0]).toMatchObject({ status: "ready" });
  });
});
