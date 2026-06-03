import { describe, it, expect } from "vitest";
import { decideNotify } from "../lib/notify.js";

describe("decideNotify", () => {
  it("fires escalation regardless of channels", () => {
    expect(
      decideNotify("escalation", { channels: ["watched"] }),
    ).toEqual({ fire: true, matchedChannels: ["escalation"] });
  });

  it("escalation still fires with empty channels list", () => {
    expect(
      decideNotify("escalation", { channels: [] }),
    ).toEqual({ fire: true, matchedChannels: ["escalation"] });
  });

  it("'all' channel fires every level", () => {
    for (const level of ["escalation", "watched", "completion", "pr_open"] as const) {
      expect(decideNotify(level, { channels: ["all"] }).fire).toBe(true);
    }
  });

  it("watched only fires when watched channel is configured", () => {
    expect(
      decideNotify("watched", { channels: ["escalation"] }).fire,
    ).toBe(false);
    expect(
      decideNotify("watched", { channels: ["watched"] }).fire,
    ).toBe(true);
    expect(
      decideNotify("completion", { channels: ["watched"] }).fire,
    ).toBe(true);
  });

  it("pr_open only fires when 'all' is configured", () => {
    expect(
      decideNotify("pr_open", { channels: ["escalation", "watched"] }).fire,
    ).toBe(false);
    expect(
      decideNotify("pr_open", { channels: ["all"] }).fire,
    ).toBe(true);
  });

  it("default dark-mode posture (escalation only) silences pr_open + completion", () => {
    const settings = { channels: ["escalation" as const] };
    expect(decideNotify("pr_open", settings).fire).toBe(false);
    expect(decideNotify("completion", settings).fire).toBe(false);
    expect(decideNotify("escalation", settings).fire).toBe(true);
  });
});
