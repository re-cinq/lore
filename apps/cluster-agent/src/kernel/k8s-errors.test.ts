// The status-code reading every catch in this service depends on. It is here
// because the alternative — a bare `catch` — is what let the Floor's missing
// `delete` verb hide behind 2,686 accumulated CRs for forty days.
import { describe, it, expect } from "vitest";
import {
  describeK8sError,
  isConflict,
  isNotFound,
  statusOf,
} from "./k8s-errors.js";

describe("statusOf", () => {
  it("reads the code this client version sets", () => {
    expect(statusOf({ code: 404 })).toBe(404);
  });

  it("reads statusCode when the error carries that instead", () => {
    expect(statusOf({ statusCode: 409 })).toBe(409);
  });

  it("reads a nested response.statusCode as the last resort", () => {
    expect(statusOf({ response: { statusCode: 403 } })).toBe(403);
  });

  it("returns undefined for a plain Error with no status at all", () => {
    expect(statusOf(new Error("socket hang up"))).toBeUndefined();
  });
});

describe("isNotFound / isConflict", () => {
  it("treats only 404 as absence", () => {
    expect([isNotFound({ code: 404 }), isNotFound({ code: 403 })]).toEqual([
      true,
      false,
    ]);
  });

  it("treats only 409 as a conflict", () => {
    expect([isConflict({ code: 409 }), isConflict({ code: 500 })]).toEqual([
      true,
      false,
    ]);
  });
});

describe("describeK8sError", () => {
  it("names the missing Role rule on a 403", () => {
    expect(
      describeK8sError(
        "delete",
        "cr-1",
        Object.assign(new Error("Forbidden"), { code: 403 }),
      ),
    ).toBe(
      "delete agents/cr-1 failed with 403 — the cluster-agent Role is missing this rule: Forbidden",
    );
  });

  it("names the verb and status without a Role hint on a 500", () => {
    expect(
      describeK8sError(
        "get",
        "cr-1",
        Object.assign(new Error("boom"), { code: 500 }),
      ),
    ).toBe("get agents/cr-1 failed with 500: boom");
  });

  it("says no status rather than undefined when the error carries none", () => {
    expect(describeK8sError("get", "cr-1", new Error("socket hang up"))).toBe(
      "get agents/cr-1 failed with no status: socket hang up",
    );
  });
});
