import { describe, it, expect } from "vitest";
import { LlmDispatchGate } from "./llm-dispatch-gate.js";

const AT = new Date("2026-08-20T09:14:00Z");

describe("LlmDispatchGate", () => {
  it("allows dispatch until something trips it", () => {
    expect(new LlmDispatchGate(() => AT).isBlocked()).toEqual(false);
  });

  it("trips on a dry account and blocks dispatch from then on", () => {
    const gate = new LlmDispatchGate(() => AT);

    expect(gate.trip("anthropic-credit", "Credit balance is too low")).toEqual(
      true,
    );
    expect(gate.isBlocked()).toEqual(true);
  });

  it("reports the cause and when it started", () => {
    const gate = new LlmDispatchGate(() => AT);

    gate.trip("anthropic-credit", "Credit balance is too low");

    expect(gate.state()).toEqual({
      blocked: true,
      cause: "Credit balance is too low",
      since: AT,
    });
  });

  it("reports no cause while dispatch is allowed", () => {
    expect(new LlmDispatchGate(() => AT).state()).toEqual({
      blocked: false,
      cause: null,
      since: null,
    });
  });

  it("keeps the first trip's timestamp when a second run reports the same outage", () => {
    let now = AT;
    const gate = new LlmDispatchGate(() => now);

    gate.trip("anthropic-credit", "Credit balance is too low");
    now = new Date("2026-08-20T10:53:00Z");

    expect(gate.trip("anthropic-credit", "Credit balance is too low")).toEqual(
      false,
    );
    expect(gate.state().since).toEqual(AT);
  });

  it("does not trip on a failure that is only this run's problem", () => {
    const gate = new LlmDispatchGate(() => AT);

    expect(gate.trip("infra", "pod OOMKilled")).toEqual(false);
    expect(gate.trip("github-permission", "403 Forbidden")).toEqual(false);
    expect(gate.trip("unknown", "exit status 1")).toEqual(false);
    expect(gate.isBlocked()).toEqual(false);
  });

  it("does not trip on a rate limit, which clears on its own", () => {
    const gate = new LlmDispatchGate(() => AT);

    expect(gate.trip("anthropic-rate-limit", "429")).toEqual(false);
    expect(gate.isBlocked()).toEqual(false);
  });

  it("trips with no detail text at all", () => {
    const gate = new LlmDispatchGate(() => AT);

    expect(gate.trip("anthropic-credit")).toEqual(true);
    expect(gate.state().cause).toEqual(
      "the Anthropic account is out of credits",
    );
  });

  it("clears once the account is healthy again, and reports it had been blocked", () => {
    const gate = new LlmDispatchGate(() => AT);

    gate.trip("anthropic-credit", "Credit balance is too low");

    expect(gate.clear()).toEqual(true);
    expect(gate.isBlocked()).toEqual(false);
  });

  it("stamps the wall clock when constructed without one", () => {
    const before = Date.now();
    const gate = new LlmDispatchGate();

    gate.trip("anthropic-credit", "Credit balance is too low");
    const since = gate.state().since;

    expect(since).toBeInstanceOf(Date);
    expect(since!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("clearing an untripped gate reports that nothing was blocked", () => {
    expect(new LlmDispatchGate(() => AT).clear()).toEqual(false);
  });
});
