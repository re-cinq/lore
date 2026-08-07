import { describe, it, expect, afterEach } from "vitest";
import {
  agentTurnsEnabled,
  turnFromEnvelope,
  MAX_RUN_TURNS_PER_BATCH,
} from "./agent-run-turns.js";

const ORIGINAL_FLAG = process.env.LORE_AGENT_TURNS;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) {
    delete process.env.LORE_AGENT_TURNS;

    return;
  }
  process.env.LORE_AGENT_TURNS = ORIGINAL_FLAG;
});

const envelope = (
  event: Record<string, unknown>,
  source: Record<string, string> = { task: "t1" },
) => ({
  source,
  event,
});

describe("agentTurnsEnabled", () => {
  it("is off when LORE_AGENT_TURNS is unset", () => {
    delete process.env.LORE_AGENT_TURNS;

    expect(agentTurnsEnabled()).toBe(false);
  });

  it("is off for any value other than 1", () => {
    process.env.LORE_AGENT_TURNS = "true";

    expect(agentTurnsEnabled()).toBe(false);
  });

  it("is on when LORE_AGENT_TURNS is 1", () => {
    process.env.LORE_AGENT_TURNS = "1";

    expect(agentTurnsEnabled()).toBe(true);
  });
});

describe("turnFromEnvelope", () => {
  it("carries the task, the agent CR name and the raw line kind", () => {
    const parsed = envelope(
      { type: "assistant" },
      { task: "t1", agent: "cr-a" },
    );

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      taskId: "t1",
      agentCrName: "cr-a",
      eventType: "assistant",
    });
  });

  it("stores the raw line verbatim when redaction changes nothing", () => {
    const parsed = envelope({ type: "assistant", text: "hello" });
    const raw = JSON.stringify(parsed);

    expect(turnFromEnvelope(parsed, raw)?.envelope).toBe(raw);
  });

  it("stores the untruncated envelope, however large the line", () => {
    // Spaces on purpose: an unbroken 200k alphanumeric run is a base64 blob to
    // the redactor, which would make this assert redaction rather than size.
    const text = "a line of agent prose ".repeat(10_000);
    const parsed = envelope({ type: "assistant", text });
    const raw = JSON.stringify(parsed);

    expect(turnFromEnvelope(parsed, raw)?.envelope).toBe(raw);
  });

  it("redacts a secret out of the stored envelope", () => {
    const parsed = envelope({
      type: "assistant",
      text: `key sk-${"a".repeat(24)} end`,
    });

    const stored = turnFromEnvelope(parsed, JSON.stringify(parsed))?.envelope;

    expect(stored).toContain("[REDACTED:api-key]");
    expect(stored).not.toContain("sk-aaaa");
  });

  it("drops the turn when redaction leaves the line unparseable as JSON", () => {
    const parsed = envelope({ type: "assistant" });

    expect(
      turnFromEnvelope(parsed, JSON.stringify(parsed), () => '{"broken"'),
    ).toBeNull();
  });

  it("keeps a turn whose envelope the subsystem attributed to no task", () => {
    const parsed = envelope({ type: "result" }, {});

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      taskId: null,
      agentCrName: null,
    });
  });

  it("keeps a turn of a line kind it has never seen, with a null kind when absent", () => {
    const parsed = envelope({ subtype: "brand_new" });

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      eventType: null,
    });
  });

  it("caps a batch at the same order as the run-visualization projection", () => {
    expect(MAX_RUN_TURNS_PER_BATCH).toBe(10_000);
  });
});
