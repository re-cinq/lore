import { describe, it, expect } from "vitest";
import { callbackAction, signInFailureMessage } from "./sign-in-callback";

const query = (text: string) => new URLSearchParams(text);

describe("callbackAction", () => {
  it("redeems the code lore-api sent back", () => {
    expect(callbackAction(query("code=abc"))).toEqual({
      action: "redeem",
      code: "abc",
    });
  });

  it("reports the reason lore-api gave for a failed sign-in", () => {
    expect(callbackAction(query("auth_error=not_in_org"))).toEqual({
      action: "failed",
      reason: "not_in_org",
    });
  });

  it("treats an unknown reason as a GitHub refusal", () => {
    expect(callbackAction(query("auth_error=whatever"))).toEqual({
      action: "failed",
      reason: "github_denied",
    });
  });

  it("rejects a callback that carries neither a code nor a reason", () => {
    expect(callbackAction(query(""))).toEqual({ action: "invalid" });
  });

  it("lets a failure reason win over a code", () => {
    expect(callbackAction(query("code=abc&auth_error=state_expired"))).toEqual({
      action: "failed",
      reason: "state_expired",
    });
  });
});

describe("signInFailureMessage", () => {
  it("tells a person outside the org so", () => {
    expect(signInFailureMessage("not_in_org")).toBe(
      "Your GitHub account is not a member of the organisation that runs this Lore.",
    );
  });

  it("tells an expired sign-in to start again", () => {
    expect(signInFailureMessage("state_expired")).toBe(
      "The sign-in took too long. Start again.",
    );
  });

  it("explains a GitHub refusal in general terms", () => {
    expect(signInFailureMessage("github_denied")).toBe(
      "GitHub did not complete the sign-in.",
    );
  });
});
