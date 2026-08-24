import { describe, it, expect } from "vitest";
import { fanOutClause } from "./fan-out.js";

describe("fanOutClause", () => {
  it("inserts one delivery per subscriber of the named event, reading the CTE it is given", () => {
    const sql = fanOutClause("ev");

    expect(sql).toContain("INSERT INTO pipeline.event_deliveries");
    expect(sql).toContain("FROM ev e");
    expect(sql).toContain(
      "JOIN pipeline.event_subscriptions s ON s.event_name = e.event_name",
    );
  });

  it("carries the subscriber's own visibility timeout onto the delivery row", () => {
    expect(fanOutClause("ev")).toContain("s.visibility_timeout_seconds");
  });

  it("re-running the same fan-out adds no second delivery for a subscriber", () => {
    expect(fanOutClause("ev")).toContain(
      "ON CONFLICT (event_id, subscriber) DO NOTHING",
    );
  });
});
