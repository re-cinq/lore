// The status-code reading every catch in this service depends on. It is here
// because the alternative — a bare `catch` — is what let the Floor's missing
// `delete` verb hide behind 2,686 accumulated CRs for forty days.
import { describe, it, expect } from "vitest";
import {
  describeK8sError,
  isConflict,
  isNotFound,
  isPodLogUnavailable,
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

describe("isPodLogUnavailable", () => {
  it("treats a 404 (pod gone) and a 400 (container terminated) as unavailable", () => {
    expect([
      isPodLogUnavailable({ code: 404 }),
      isPodLogUnavailable({
        code: 400,
        message: 'container "agent" in pod "agent-job-x-h5sj7" is terminated',
      }),
    ]).toEqual([true, true]);
  });

  it("reads the prose-only variant the client surfaces for a kubelet 400", () => {
    expect(
      isPodLogUnavailable(
        new Error(
          'HTTP-Code: 400\nMessage: Unknown API Status Code!\nBody: "{}"',
        ),
      ),
    ).toBe(true);
  });

  it("keeps a 403 and a 500 as genuine faults", () => {
    expect([
      isPodLogUnavailable({ code: 403 }),
      isPodLogUnavailable({ code: 500 }),
    ]).toEqual([false, false]);
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

describe("a status carried only in the message", () => {
  // The shape the client actually throws for a Secret write that lost an
  // optimistic-concurrency race. Verbatim from production, 2026-08-25: the 409
  // is nowhere structured, so `code`/`statusCode`/`response.statusCode` are all
  // undefined and isConflict said false. The mutate() retry that exists for
  // exactly this case therefore never fired, per-task-tokens 500'd, and no agent
  // could be launched while several provisioned at once.
  const asClientThrowsIt = new Error(
    'HTTP-Code: 409\nMessage: Unknown API Status Code!\nBody: "{\\"kind\\":\\"Status\\",\\"status\\":\\"Failure\\",\\"message\\":\\"Operation cannot be fulfilled on secrets \\\\\\"agent-secrets\\\\\\": the object has been modified\\",\\"reason\\":\\"Conflict\\",\\"code\\":409}"',
  );

  it("reads 409 out of the message when it is nowhere else", () => {
    expect(isConflict(asClientThrowsIt)).toBe(true);
  });

  it("still prefers a structured status when there is one", () => {
    expect(isConflict({ code: 409 })).toBe(true);
    expect(isConflict({ response: { statusCode: 409 } })).toBe(true);
  });

  it("does not read a 409 out of an unrelated message", () => {
    expect(isConflict(new Error("connection reset"))).toBe(false);
    expect(isConflict(new Error("HTTP-Code: 404"))).toBe(false);
  });

  it("reads no status from a thrown value whose message is not a string", () => {
    // A rejected non-Error — a bare object, a string — reaches here too. Reading
    // `.message` off it and handing a non-string to the regex would throw from
    // inside the classifier that exists to keep failures legible.
    expect([
      isConflict({ message: 409 }),
      isConflict("HTTP-Code: 409"),
      isConflict(null),
    ]).toEqual([false, false, false]);
  });
});
