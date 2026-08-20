import { describe, it, expect } from "vitest";
import { decideLlmStatus } from "./llm-status.js";

const AT = new Date("2026-08-20T09:14:00Z");

describe("decideLlmStatus", () => {
  it("reports healthy when nothing recent failed on the account", () => {
    expect(decideLlmStatus([])).toEqual({
      degraded: false,
      failure_class: null,
      detail: null,
      since: null,
      affected_runs: 0,
    });
  });

  it("reports the outage, its cause, and how many runs it has eaten", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "anthropic-credit",
          failure_detail: "Credit balance is too low",
          oldest: AT,
          runs: 12,
        },
      ]),
    ).toEqual({
      degraded: true,
      failure_class: "anthropic-credit",
      detail: "Credit balance is too low",
      since: AT,
      affected_runs: 12,
    });
  });

  it("ignores failures that are one run's problem rather than the account's", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "infra",
          failure_detail: "pod OOMKilled",
          oldest: AT,
          runs: 40,
        },
      ]).degraded,
    ).toEqual(false);
  });

  it("reports the account-wide class even when local failures outnumber it", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "infra",
          failure_detail: "pod OOMKilled",
          oldest: AT,
          runs: 40,
        },
        {
          failure_class: "anthropic-credit",
          failure_detail: "Credit balance is too low",
          oldest: AT,
          runs: 2,
        },
      ]),
    ).toMatchObject({ degraded: true, failure_class: "anthropic-credit" });
  });

  it("survives a row whose detail was never recorded", () => {
    expect(
      decideLlmStatus([
        {
          failure_class: "anthropic-credit",
          failure_detail: null,
          oldest: AT,
          runs: 1,
        },
      ]),
    ).toMatchObject({ degraded: true, detail: null });
  });
});
