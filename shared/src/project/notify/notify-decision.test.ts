import { describe, it, expect } from "vitest";
import { decideNotify } from "./notify-decision.js";

/**
 * decideNotify (relocated from agent) — channel filtering, byte-for-byte the
 * same rules. Real inputs, no mocks.
 */

describe("decideNotify", () => {
  it("fires for any level when channels include all", () => {
    expect(decideNotify("pr_open", ["all"])).toEqual({ fire: true, matchedChannels: ["all"] });
  });

  it("always fires escalation regardless of channels", () => {
    expect(decideNotify("escalation", [])).toEqual({ fire: true, matchedChannels: ["escalation"] });
  });

  it("fires watched only when the watched channel is listed", () => {
    expect(decideNotify("watched", ["watched"])).toEqual({ fire: true, matchedChannels: ["watched"] });
    expect(decideNotify("watched", [])).toEqual({ fire: false, matchedChannels: [] });
  });

  it("suppresses pr_open unless all is listed", () => {
    expect(decideNotify("pr_open", ["watched"])).toEqual({ fire: false, matchedChannels: [] });
  });
});
