import { describe, it, expect } from "vitest";
import { stationNodeOutcome } from "@re-cinq/lore-assembly-lines";
import { normalizeAgentStatus } from "./node-terminal.js";

describe("normalizeAgentStatus", () => {
  const bootCrash = [
    '{"kind":"lifecycle","phase":"agent","status":"started"}',
    "[agent] Error: Settings file not found: /agent/.claude/settings.json",
    '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
  ].join("\n");

  it("lifts the relayed stderr when the engine died before any result line", () => {
    expect(
      normalizeAgentStatus({ phase: "Failed", output: bootCrash }).errorText,
    ).toBe("Error: Settings file not found: /agent/.claude/settings.json");
  });

  it("still prefers a real result line over the relayed stderr", () => {
    const output = [
      "[agent] noise on the other stream",
      JSON.stringify({
        type: "result",
        is_error: true,
        result: "Credit balance is too low",
      }),
      '{"kind":"lifecycle","exitCode":1,"phase":"agent","status":"failed"}',
    ].join("\n");

    expect(normalizeAgentStatus({ phase: "Failed", output }).errorText).toBe(
      "Credit balance is too low",
    );
  });

  it("classifies the boot crash as permanent config, not as retryable infra", () => {
    expect(
      stationNodeOutcome(
        { type: "agent" },
        normalizeAgentStatus({
          phase: "Failed",
          output: bootCrash,
          failureReason:
            "BackoffLimitExceeded: Job has reached the specified backoff limit",
        }),
      ),
    ).toMatchObject({
      failureClass: "agent-settings-missing",
      failureDetail:
        "Error: Settings file not found: /agent/.claude/settings.json",
    });
  });

  it("unwraps the NDJSON envelope into the agent text", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: false,
      result: "REVIEW_RESULT:APPROVED",
    });

    expect(normalizeAgentStatus({ phase: "Succeeded", output })).toEqual({
      phase: "Succeeded",
      output: "REVIEW_RESULT:APPROVED",
    });
  });

  it("leaves plain output untouched", () => {
    expect(
      normalizeAgentStatus({ phase: "Succeeded", output: "plain text" }),
    ).toEqual({ phase: "Succeeded", output: "plain text" });
  });

  it("leaves a status without output untouched", () => {
    expect(normalizeAgentStatus({ phase: "Failed" })).toEqual({
      phase: "Failed",
    });
  });

  it("lifts the agent's terminal error text off the raw stream before unwrapping", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });

    expect(normalizeAgentStatus({ phase: "Failed", output })).toEqual({
      phase: "Failed",
      output: "Credit balance is too low",
      errorText: "Credit balance is too low",
    });
  });

  it("carries no error text when the stream ended without an error result", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: false,
      result: "REVIEW_RESULT:APPROVED",
    });

    expect(normalizeAgentStatus({ phase: "Succeeded", output }).errorText).toBe(
      undefined,
    );
  });

  it("is idempotent: re-normalizing keeps the error text it already lifted", () => {
    const output = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });
    const once = normalizeAgentStatus({ phase: "Failed", output });

    expect(normalizeAgentStatus(once)).toEqual(once);
  });
});
