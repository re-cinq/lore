import { describe, it, expect } from "vitest";

// ── Review result parsing (regex from loretask-controller.ts) ───────

const REVIEW_RESULT_RE =
  /REVIEW_RESULT:(APPROVED|CHANGES_REQUESTED(?::[\s\S]*)?)/;

describe("review result parsing", () => {
  it("parses REVIEW_RESULT:APPROVED", () => {
    const logs = "some output\nREVIEW_RESULT:APPROVED\nmore output";
    const match = logs.match(REVIEW_RESULT_RE);
    expect(match?.[1]).toBe("APPROVED");
  });

  it("parses REVIEW_RESULT:CHANGES_REQUESTED without feedback", () => {
    const logs = "output\nREVIEW_RESULT:CHANGES_REQUESTED\nmore";
    const match = logs.match(REVIEW_RESULT_RE);
    expect(match?.[1]).toBe("CHANGES_REQUESTED");
  });

  it("parses REVIEW_RESULT:CHANGES_REQUESTED with feedback", () => {
    const logs =
      "output\nREVIEW_RESULT:CHANGES_REQUESTED:Fix the auth check\nmore";
    const match = logs.match(REVIEW_RESULT_RE);
    expect(match?.[1]).toContain("CHANGES_REQUESTED");
    expect(match?.[1]).toContain("Fix the auth check");
  });

  it("parses multiline feedback after CHANGES_REQUESTED", () => {
    const logs =
      "output\nREVIEW_RESULT:CHANGES_REQUESTED:Line 1\nLine 2\nLine 3";
    const match = logs.match(REVIEW_RESULT_RE);
    expect(match?.[1]).toContain("CHANGES_REQUESTED");
    expect(match?.[1]).toContain("Line 1");
    // [\s\S]* is greedy — captures to end of string
    expect(match?.[1]).toContain("Line 3");
  });

  it("returns null when no result found", () => {
    const match = "no review result here".match(REVIEW_RESULT_RE);
    expect(match).toBeNull();
  });

  it("returns null for partial match REVIEW_RESULT:", () => {
    const match = "REVIEW_RESULT:INVALID_STATUS".match(REVIEW_RESULT_RE);
    expect(match).toBeNull();
  });

  it("maps APPROVED to approved status", () => {
    const logs = "REVIEW_RESULT:APPROVED";
    const match = logs.match(REVIEW_RESULT_RE);
    const isApproved = match?.[1]?.startsWith("APPROVED");
    expect(isApproved).toBe(true);
  });

  it("maps CHANGES_REQUESTED to changes-requested status", () => {
    const logs = "REVIEW_RESULT:CHANGES_REQUESTED:Fix imports";
    const match = logs.match(REVIEW_RESULT_RE);
    const isApproved = match?.[1]?.startsWith("APPROVED");
    expect(isApproved).toBe(false);

    const status = isApproved ? "approved" : "changes-requested";
    expect(status).toBe("changes-requested");
  });
});

// ── parseChangedFiles (copied from loretask-controller.ts) ──────────

function parseChangedFiles(logs: string): number {
  const match = logs.match(/CHANGES=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

describe("parseChangedFiles", () => {
  it("extracts the file count from CHANGES=N", () => {
    expect(parseChangedFiles("some output\nCHANGES=5\ndone")).toBe(5);
  });

  it("returns 0 when no CHANGES= line found", () => {
    expect(parseChangedFiles("just regular output")).toBe(0);
  });

  it("handles CHANGES=0", () => {
    expect(parseChangedFiles("CHANGES=0")).toBe(0);
  });

  it("handles large numbers", () => {
    expect(parseChangedFiles("CHANGES=42")).toBe(42);
  });
});

// ── parseFailureReason (copied from loretask-controller.ts) ─────────

function parseFailureReason(
  logs: string,
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>,
): string {
  const failedCondition = conditions.find(
    (c) => c.type === "Failed" && c.status === "True",
  );
  const conditionReason = failedCondition?.reason || "";
  const conditionMessage = failedCondition?.message || "";

  const logLines = logs.trim().split("\n");
  const lastLines = logLines.slice(-10).join("\n");
  const errorMatch = lastLines.match(/(?:Error|FATAL|FAILED):\s*(.+)/i);
  const logError = errorMatch?.[1] || "";

  if (logError) return logError;
  if (conditionMessage) return `${conditionReason}: ${conditionMessage}`;
  if (conditionReason) return conditionReason;
  return "Unknown failure (check pod logs)";
}

describe("parseFailureReason", () => {
  it("extracts error from pod logs (highest priority)", () => {
    const logs = "starting...\nprocessing...\nError: Cannot find module 'foo'\ndone";
    const result = parseFailureReason(logs, [
      { type: "Failed", status: "True", reason: "BackoffLimitExceeded", message: "Job failed" },
    ]);
    expect(result).toBe("Cannot find module 'foo'");
  });

  it("extracts FATAL errors from logs", () => {
    const logs = "FATAL: Out of memory";
    const result = parseFailureReason(logs, []);
    expect(result).toBe("Out of memory");
  });

  it("extracts FAILED errors from logs", () => {
    const logs = "FAILED: git push rejected";
    const result = parseFailureReason(logs, []);
    expect(result).toBe("git push rejected");
  });

  it("falls back to condition message when no log error", () => {
    const result = parseFailureReason("clean logs with no errors", [
      { type: "Failed", status: "True", reason: "DeadlineExceeded", message: "Job exceeded 30m timeout" },
    ]);
    expect(result).toBe("DeadlineExceeded: Job exceeded 30m timeout");
  });

  it("falls back to condition reason when no message", () => {
    const result = parseFailureReason("clean logs", [
      { type: "Failed", status: "True", reason: "BackoffLimitExceeded" },
    ]);
    expect(result).toBe("BackoffLimitExceeded");
  });

  it("returns default message when nothing found", () => {
    const result = parseFailureReason("clean logs", []);
    expect(result).toBe("Unknown failure (check pod logs)");
  });

  it("only looks at last 10 lines of logs for errors", () => {
    const earlyError = "Error: this should be ignored\n";
    const filler = "normal line\n".repeat(15);
    const logs = earlyError + filler;
    const result = parseFailureReason(logs, []);
    // Error is more than 10 lines from the end, so it should be missed
    expect(result).toBe("Unknown failure (check pod logs)");
  });

  it("ignores non-Failed conditions", () => {
    const result = parseFailureReason("clean logs", [
      { type: "Complete", status: "True", reason: "Completed" },
    ]);
    expect(result).toBe("Unknown failure (check pod logs)");
  });
});

// ── 409 handling (pattern from worker.ts handleClaudeCodeTask) ──────

describe("409 conflict detection", () => {
  it("detects 409 via error code property", () => {
    const err = { code: 409 };
    const is409 =
      err?.code === 409 ||
      (err as any)?.response?.statusCode === 409 ||
      String((err as any)?.message).includes("already exists");
    expect(is409).toBe(true);
  });

  it("detects 409 via response.statusCode", () => {
    const err = { response: { statusCode: 409 } };
    const is409 =
      (err as any)?.code === 409 ||
      err?.response?.statusCode === 409 ||
      String((err as any)?.message).includes("already exists");
    expect(is409).toBe(true);
  });

  it("detects 409 via 'already exists' in message", () => {
    const err = { message: 'loretasks.lore.re-cinq.com "loretask-abcd1234" already exists' };
    const is409 =
      (err as any)?.code === 409 ||
      (err as any)?.response?.statusCode === 409 ||
      String(err?.message).includes("already exists");
    expect(is409).toBe(true);
  });

  it("does not match non-409 errors", () => {
    const err = { code: 500, message: "internal server error" };
    const is409 =
      err?.code === 409 ||
      (err as any)?.response?.statusCode === 409 ||
      String(err?.message).includes("already exists");
    expect(is409).toBe(false);
  });
});
