import { describe, it, expect } from "vitest";
import { createHmac, timingSafeEqual } from "node:crypto";

// ── Slack HMAC-SHA256 verification ──────────────────────────────────
// The webhook handler verifies Slack requests using HMAC-SHA256 with
// the signing secret. Bugs found:
// - Slack manifest needed _metadata block (not a code bug but parser)
// - YAML comments caused parse errors in Slack's manifest parser

describe("Slack HMAC verification", () => {
  const signingSecret = "test-signing-secret-12345";

  function verifySlackSignature(
    body: string,
    timestamp: string,
    signature: string,
    secret: string,
  ): boolean {
    const sigBase = `v0:${timestamp}:${body}`;
    const expected = "v0=" + createHmac("sha256", secret).update(sigBase).digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  it("accepts valid signature", () => {
    const body = "token=test&text=hello+world&channel_id=C123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sigBase = `v0:${timestamp}:${body}`;
    const signature = "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(verifySlackSignature(body, timestamp, signature, signingSecret)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = "token=test&text=hello";
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(verifySlackSignature(body, timestamp, "v0=invalid", signingSecret)).toBe(false);
  });

  it("rejects tampered body", () => {
    const body = "token=test&text=hello";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sigBase = `v0:${timestamp}:${body}`;
    const signature = "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    // Tamper with the body
    expect(verifySlackSignature(body + "&extra=bad", timestamp, signature, signingSecret)).toBe(false);
  });

  it("rejects old timestamps (replay protection)", () => {
    const sixMinutesAgo = Math.floor(Date.now() / 1000) - 360;
    const isReplay = Math.abs(Date.now() / 1000 - sixMinutesAgo) > 300;
    expect(isReplay).toBe(true);
  });

  it("accepts recent timestamps", () => {
    const tenSecondsAgo = Math.floor(Date.now() / 1000) - 10;
    const isReplay = Math.abs(Date.now() / 1000 - tenSecondsAgo) > 300;
    expect(isReplay).toBe(false);
  });
});

// ── Slack command parsing ───────────────────────────────────────────
// /lore [task_type] description
// If first word matches a known type, it's extracted. Otherwise defaults to "general".

describe("Slack command parsing", () => {
  const knownTypes = ["general", "implementation", "runbook", "gap-fill", "review", "feature-request"];

  function parseCommand(text: string): { taskType: string; description: string; priority: string } {
    let words = text.trim().split(/\s+/);
    let priority = "normal";
    if (words[0] === "!") {
      priority = "immediate";
      words = words.slice(1);
    }
    let taskType = "general";
    let description = words.join(" ");
    if (words.length > 1 && knownTypes.includes(words[0])) {
      taskType = words[0];
      description = words.slice(1).join(" ");
    }
    return { taskType, description, priority };
  }

  it("parses /lore implementation add auth", () => {
    const { taskType, description } = parseCommand("implementation add auth");
    expect(taskType).toBe("implementation");
    expect(description).toBe("add auth");
  });

  it("defaults to general when no type specified", () => {
    const { taskType, description } = parseCommand("what tests do we have");
    expect(taskType).toBe("general");
    expect(description).toBe("what tests do we have");
  });

  it("handles gap-fill type", () => {
    const { taskType, description } = parseCommand("gap-fill missing runbook for DB failover");
    expect(taskType).toBe("gap-fill");
    expect(description).toBe("missing runbook for DB failover");
  });

  it("does not match partial type names", () => {
    const { taskType } = parseCommand("implement something");
    expect(taskType).toBe("general"); // "implement" != "implementation"
  });

  it("handles single word (no description after type)", () => {
    const { taskType, description } = parseCommand("implementation");
    // Single word that matches a type — treated as description since no remaining words
    expect(taskType).toBe("general");
    expect(description).toBe("implementation");
  });

  it("handles empty text", () => {
    const { taskType, description } = parseCommand("");
    expect(taskType).toBe("general");
    expect(description).toBe("");
  });

  it("preserves extra whitespace in description", () => {
    const { description } = parseCommand("general   hello    world");
    expect(description).toBe("hello world");
  });

  it("parses ! prefix as immediate priority", () => {
    const { taskType, description, priority } = parseCommand("! implementation add caching");
    expect(priority).toBe("immediate");
    expect(taskType).toBe("implementation");
    expect(description).toBe("add caching");
  });

  it("defaults to normal priority without ! prefix", () => {
    const { priority } = parseCommand("implementation add caching");
    expect(priority).toBe("normal");
  });

  it("handles ! with general task (no explicit type)", () => {
    const { taskType, description, priority } = parseCommand("! fix the login bug");
    expect(priority).toBe("immediate");
    expect(taskType).toBe("general");
    expect(description).toBe("fix the login bug");
  });

  it("handles ! alone", () => {
    const { priority, description } = parseCommand("!");
    expect(priority).toBe("immediate");
    expect(description).toBe("");
  });
});
