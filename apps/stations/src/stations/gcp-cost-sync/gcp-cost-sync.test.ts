import { describe, it, expect } from "vitest";
import { InMemoryGcpCost } from "@re-cinq/lore-shared/project/cost/cost-memory.js";
import { billingWindowStart, gcpCostSyncJob } from "./gcp-cost-sync.js";

describe("gcpCostSyncJob", () => {
  it("returns a skip summary without throwing when the billing env is unset", async () => {
    expect(await gcpCostSyncJob(new InMemoryGcpCost(), {})).toMatch(
      /LORE_GCP_BILLING_PROJECT \/ LORE_GCP_BILLING_DATASET not set/,
    );
  });

  it("skips when only one of the two billing env vars is set", async () => {
    expect(
      await gcpCostSyncJob(new InMemoryGcpCost(), {
        LORE_GCP_BILLING_PROJECT: "re5-n8n-platform",
      }),
    ).toMatch(/not set; skipping/);
  });
});

describe("billingWindowStart", () => {
  it("starts 30 days before today's UTC midnight, spanning 31 candidate days", () => {
    expect(billingWindowStart(new Date("2026-09-03T13:00:00.000Z"))).toBe(
      "2026-08-04T00:00:00.000Z",
    );
  });

  it("aligns the start to UTC midnight regardless of the time of day", () => {
    expect(billingWindowStart(new Date("2026-09-03T00:00:01.000Z"))).toBe(
      billingWindowStart(new Date("2026-09-03T23:59:59.000Z")),
    );
  });
});
