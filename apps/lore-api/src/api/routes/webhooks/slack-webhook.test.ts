import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { parseSlashCommand, verifySlackSignature } from "./webhook-slack.js";

describe("Slack HMAC verification", () => {
  const signingSecret = "test-signing-secret-12345";

  it("accepts valid signature", () => {
    const body = "token=test&text=hello+world&channel_id=C123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sigBase = `v0:${timestamp}:${body}`;
    const signature =
      "v0=" + createHmac("sha256", signingSecret).update(sigBase).digest("hex");

    expect(
      verifySlackSignature(signingSecret, timestamp, signature, body),
    ).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = "token=test&text=hello";
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(
      verifySlackSignature(signingSecret, timestamp, "v0=invalid", body),
    ).toBe(false);
  });

  it("rejects tampered body", () => {
    const body = "token=test&text=hello";
    const timestamp = String(Math.floor(Date.now() / 1000));
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

describe("Slack command parsing", () => {
  it("parses /lore implementation add auth", () => {
    const { taskType, description } = parseSlashCommand(
      "implementation add auth",
    );

    expect(taskType).toBe("implementation");
    expect(description).toBe("add auth");
  });

  it("defaults to general when no type specified", () => {
    const { taskType, description } = parseSlashCommand(
      "what tests do we have",
    );

    expect(taskType).toBe("general");
    expect(description).toBe("what tests do we have");
  });

  it("handles gap-fill type", () => {
    const { taskType, description } = parseSlashCommand(
      "gap-fill missing runbook for DB failover",
    );

    expect(taskType).toBe("gap-fill");
    expect(description).toBe("missing runbook for DB failover");
  });

  it("does not match partial type names", () => {
    const { taskType } = parseSlashCommand("implement something");

    expect(taskType).toBe("general");
  });

  it("handles single word (no description after type)", () => {
    const { taskType, description } = parseSlashCommand("implementation");

    expect(taskType).toBe("general");
    expect(description).toBe("implementation");
  });

  it("handles empty text", () => {
    const { taskType, description } = parseSlashCommand("");

    expect(taskType).toBe("general");
    expect(description).toBe("");
  });

  it("preserves extra whitespace in description", () => {
    const { description } = parseSlashCommand("general   hello    world");

    expect(description).toBe("hello world");
  });

  it("parses ! prefix as immediate priority", () => {
    const { taskType, description, priority } = parseSlashCommand(
      "! implementation add caching",
    );

    expect(priority).toBe("immediate");
    expect(taskType).toBe("implementation");
    expect(description).toBe("add caching");
  });

  it("defaults to normal priority without ! prefix", () => {
    const { priority } = parseSlashCommand("implementation add caching");

    expect(priority).toBe("normal");
  });

  it("handles ! with general task (no explicit type)", () => {
    const { taskType, description, priority } = parseSlashCommand(
      "! fix the login bug",
    );

    expect(priority).toBe("immediate");
    expect(taskType).toBe("general");
    expect(description).toBe("fix the login bug");
  });

  it("handles ! alone", () => {
    const { priority, description } = parseSlashCommand("!");

    expect(priority).toBe("immediate");
    expect(description).toBe("");
  });
});
