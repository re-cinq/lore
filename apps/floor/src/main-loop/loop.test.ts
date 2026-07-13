import { describe, it, expect } from "vitest";
import { handleOne, type LoopDeps } from "./loop.js";
import type { EventRow, EventHandler } from "./types.js";

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "1",
    event_name: "cron.merge_check.tick",
    source: "cron",
    params: {},
    repo: null,
    dedupe_key: null,
    status: "processing",
    attempts: 1,
    error: null,
    captured_at: "",
    claimed_at: "",
    next_attempt_at: "",
    handled_at: null,
    ...overrides,
  };
}

interface Recorder {
  done: string[];
  failed: Array<{ id: string; error: string; backoff: number }>;
  dead: Array<{ id: string; error: string }>;
}

function deps(handler: EventHandler | undefined, rec: Recorder): LoopDeps {
  return {
    resolve: () => handler,
    claim: async () => [],
    markDone: async (id) => {
      rec.done.push(id);
    },
    markFailed: async (id, error, backoff) => {
      rec.failed.push({ id, error, backoff });
    },
    markDead: async (id, error) => {
      rec.dead.push({ id, error });
    },
  };
}

function recorder(): Recorder {
  return { done: [], failed: [], dead: [] };
}

describe("handleOne", () => {
  it("marks done when the handler succeeds", async () => {
    const rec = recorder();

    await handleOne(
      row(),
      deps(async () => {}, rec),
    );
    expect(rec).toMatchObject({ done: ["1"], failed: [], dead: [] });
  });

  it("dead-letters immediately when no handler is registered", async () => {
    const rec = recorder();

    await handleOne(
      row({ event_name: "github.unknown.thing" }),
      deps(undefined, rec),
    );
    expect(rec.dead).toEqual([
      { id: "1", error: "no handler for github.unknown.thing" },
    ]);
    expect(rec.done).toEqual([]);
  });

  it("marks failed with backoff when the handler throws below the attempt cap", async () => {
    const rec = recorder();
    const throwing: EventHandler = async () => {
      throw new Error("boom");
    };

    await handleOne(row({ attempts: 2 }), deps(throwing, rec));
    expect(rec.failed).toEqual([{ id: "1", error: "boom", backoff: 4 }]);
    expect(rec.dead).toEqual([]);
  });

  it("dead-letters when the handler throws at the attempt cap", async () => {
    const rec = recorder();
    const throwing: EventHandler = async () => {
      throw new Error("still broken");
    };

    await handleOne(row({ attempts: 5 }), deps(throwing, rec));
    expect(rec.dead).toEqual([{ id: "1", error: "still broken" }]);
    expect(rec.failed).toEqual([]);
  });

  it("passes the event params to the handler", async () => {
    const rec = recorder();
    let seen: Record<string, unknown> | undefined;
    const capture: EventHandler = async (params) => {
      seen = params;
    };

    await handleOne(
      row({ params: { repo: "re-cinq/lore", pr_number: 7 } }),
      deps(capture, rec),
    );
    expect(seen).toEqual({ repo: "re-cinq/lore", pr_number: 7 });
  });
});
