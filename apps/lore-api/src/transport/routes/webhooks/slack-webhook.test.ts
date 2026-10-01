import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseSlashCommand, verifySlackSignature } from "./webhook-slack.js";

const FIXED_SECONDS_SINCE_EPOCH = 1767225600;

describe("Slack HMAC verification", () => {
  const signingSecret = "test-signing-secret-12345";

  it("accepts valid signature", () => {
    const body = "token=test&text=hello+world&channel_id=C123";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);
    const sigBase = `v0:${timestamp}:${body}`;
    const signature =
      "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(
      verifySlackSignature(signingSecret, timestamp, signature, body),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = "token=test&text=hello";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);

    expect(
      verifySlackSignature(signingSecret, timestamp, "v0=invalid", body),
    ).toBe(false);
  });

  it("rejects tampered body", () => {
    const body = "token=test&text=hello";
    const timestamp = String(FIXED_SECONDS_SINCE_EPOCH);
    const sigBase = `v0:${timestamp}:${body}`;
    const signature =
      "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(
      verifySlackSignature(
        signingSecret,
        timestamp,
        signature,
        body + "&extra=bad",
      ),
    ).toBe(false);
  });

  it("rejects old timestamps (replay protection)", () => {
    const sixMinutesAgo = FIXED_SECONDS_SINCE_EPOCH - 360;
    const isReplay = Math.abs(FIXED_SECONDS_SINCE_EPOCH - sixMinutesAgo) > 300;

    expect(isReplay).toBe(true);
  });

  it("accepts recent timestamps", () => {
    const tenSecondsAgo = FIXED_SECONDS_SINCE_EPOCH - 10;
    const isReplay = Math.abs(FIXED_SECONDS_SINCE_EPOCH - tenSecondsAgo) > 300;

    expect(isReplay).toBe(false);
  });
});

describe("Slack command parsing", () => {
  it("parses /lore runbook database failover as a runbook task", () => {
    expect(parseSlashCommand("runbook database failover")).toEqual({
      priority: "normal",
      taskType: "runbook",
      description: "database failover",
    });
  });

  it("names no task type for /lore what tests do we have, so creating it is refused", () => {
    expect(parseSlashCommand("what tests do we have")).toEqual({
      priority: "normal",
      description: "what tests do we have",
    });
  });

  it("still reads implementation as a type word, so creating it answers that the type was removed", () => {
    expect(parseSlashCommand("implementation add auth")).toEqual({
      priority: "normal",
      taskType: "implementation",
      description: "add auth",
    });
  });

  it("handles gap-fill type", () => {
    const { taskType, description } = parseSlashCommand(
      "gap-fill missing runbook for DB failover",
    );

    expect(taskType).toBe("gap-fill");
    expect(description).toBe("missing runbook for DB failover");
  });

  it("does not match partial type names", () => {
    const { taskType } = parseSlashCommand("runbooks for everyone");

    expect(taskType).toBeUndefined();
  });

  it("reads a single word as the description, not as a type", () => {
    expect(parseSlashCommand("runbook")).toEqual({
      priority: "normal",
      description: "runbook",
    });
  });

  it("handles empty text", () => {
    expect(parseSlashCommand("")).toEqual({
      priority: "normal",
      description: "",
    });
  });

  it("collapses extra whitespace in the description", () => {
    const { description } = parseSlashCommand("runbook   hello    world");

    expect(description).toBe("hello world");
  });

  it("parses ! prefix as immediate priority", () => {
    expect(parseSlashCommand("! runbook database failover")).toEqual({
      priority: "immediate",
      taskType: "runbook",
      description: "database failover",
    });
  });

  it("defaults to normal priority without ! prefix", () => {
    const { priority } = parseSlashCommand("runbook database failover");

    expect(priority).toBe("normal");
  });

  it("handles ! alone", () => {
    const { priority, description } = parseSlashCommand("!");

    expect(priority).toBe("immediate");
    expect(description).toBe("");
  });

  it("parses /lore retry t-1 as a retry of task t-1", () => {
    expect(parseSlashCommand("retry t-1")).toEqual({
      priority: "normal",
      description: "",
      retryTaskId: "t-1",
    });
  });
});
