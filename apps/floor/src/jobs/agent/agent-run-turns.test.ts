import { describe, it, expect } from "vitest";
import {
  turnFromEnvelope,
  MAX_RUN_TURNS_PER_BATCH,
} from "./agent-run-turns.js";

const envelope = (
  event: Record<string, unknown>,
  // `unknown`, not `string`: the attribution carries a numeric `iteration`
  // (#1147), so a string-valued map is a narrower shape than the wire's.
  source: Record<string, unknown> = { task: "t1" },
) => ({
  source,
  event,
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

  it("carries the run identity the producer stamped into the attribution", () => {
    const parsed = envelope(
      { type: "assistant" },
      {
        task: "t1",
        agent: "cr-a",
        assembly_run: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        node: "implement",
        iteration: 2,
        station_run: "11111111-2222-4333-8444-555555555555",
      },
    );

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))?.carried).toEqual({
      assemblyRunId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      nodeId: "implement",
      iteration: 2,
      stationRunId: "11111111-2222-4333-8444-555555555555",
    });
  });

  it("carries no identity for a producer that stamps none, leaving the CR-name lookup", () => {
    const parsed = envelope(
      { type: "assistant" },
      { task: "t1", agent: "cr-a" },
    );

    expect(
      turnFromEnvelope(parsed, JSON.stringify(parsed))?.carried,
    ).toBeNull();
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

describe("turnFromEnvelope dedup key (#1389)", () => {
  it("carries the relay's turn_key as the insert's dedup key", () => {
    const parsed = envelope(
      { type: "assistant" },
      { task: "t1", turn_key: "abc123" },
    );

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      dedupKey: "abc123",
    });
  });

  it("carries a null dedup key when the source has none", () => {
    const parsed = envelope({ type: "assistant" });

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      dedupKey: null,
    });
  });

  it("ignores a non-string turn_key", () => {
    const parsed = envelope(
      { type: "assistant" },
      { task: "t1", turn_key: 42 },
    );

    expect(turnFromEnvelope(parsed, JSON.stringify(parsed))).toMatchObject({
      dedupKey: null,
    });
  });
});
