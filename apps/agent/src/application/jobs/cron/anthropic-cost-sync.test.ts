import { describe, it, expect, afterEach } from "vitest";
import { anthropicCostSyncJob } from "./anthropic-cost-sync.js";

describe("anthropicCostSyncJob", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
  });

  it("returns a skip summary without throwing when ANTHROPIC_ADMIN_KEY is unset", async () => {
    delete process.env.ANTHROPIC_ADMIN_KEY;
    expect(await anthropicCostSyncJob()).toMatch(/ANTHROPIC_ADMIN_KEY not set/);
  });
});
