import { describe, it, expect } from "vitest";
import { handleOne, drainOnce, type LoopDeps } from "./loop.js";
import type { EventRow, EventHandler } from "./types.js";

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "1",
    event_id: "100",
    subscriber: "floor",
    event_name: "cron.merge_check.tick",
    source: "cron",
    params: {},
    repo: null,
    status: "processing",
    attempts: 1,
    error: null,
    claimed_at: "",
    next_attempt_at: "",
    handled_at: null,
    visibility_timeout_seconds: 600,
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

  it("passes the EVENT id as meta, not the delivery's, so a by-reference payload resolves", async () => {
    const rec = recorder();
    let metaSeen: { eventId: string } | undefined;
    const capture: EventHandler = async (_params, meta) => {
      metaSeen = meta;
    };

    // The two differ since the Floor claims its own delivery: `id` addresses the
    // delivery (ack/fail/dead take it) and `event_id` the event. A handler that
    // cites the event — the ingest station fetches a large payload as
    // `payload_event_id` — given the delivery id would read the wrong row.
    await handleOne(row({ id: "4711", event_id: "100" }), deps(capture, rec));
    expect(metaSeen).toEqual({ eventId: "100" });
  });
});

describe("drainOnce serial families", () => {
  // FR6 (specs/ingest-station): production SERIAL_FAMILIES is EMPTY — no
  // in-process dgraph writer remains. The mechanism stays as a general tool,
  // so these tests inject a family through the deps seam.
  const specTraceRow = (id: string) =>
    row({ id, event_name: "internal.ingest.spec_trace", params: { id } });

  function drainDeps(
    batches: EventRow[][],
    handler: EventHandler,
    rec: Recorder,
  ): { deps: LoopDeps; excludesSeen: string[][] } {
    const excludesSeen: string[][] = [];
    let call = 0;
    const base = deps(handler, rec);

    return {
      excludesSeen,
      deps: {
        ...base,
        serialFamilies: new Set(["internal.ingest.spec_trace"]),
        claim: async (_limit, excludeEventNames) => {
          excludesSeen.push([...excludeEventNames]);

          return batches[call++] ?? [];
        },
      },
    };
  }

  it("production default has no serial families — every event runs parallel (FR6)", async () => {
    const rec = recorder();
    const order: string[] = [];
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: EventHandler = async (params) => {
      order.push(`start:${String(params.id)}`);

      if (params.id === "st1") {
        await blocked;
      }
      order.push(`end:${String(params.id)}`);
    };
    const base = deps(handler, rec);
    const batch = [specTraceRow("st1"), specTraceRow("st2")];
    let call = 0;
    const drain = drainOnce({
      ...base,
      claim: async () => (call++ === 0 ? batch : []),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    // st2 finished while st1 is still blocked — no family serialization.
    expect(order).toContain("end:st2");
    expect(order).not.toContain("end:st1");
    release();
    await drain;
  });

  it("runs two spec_trace events one after the other while an unrelated event runs alongside", async () => {
    const rec = recorder();
    const order: string[] = [];
    let activeSpecTrace = 0;
    let maxActiveSpecTrace = 0;
    const handler: EventHandler = async (params) => {
      const isSpecTrace = typeof params.id === "string";

      if (isSpecTrace) {
        activeSpecTrace += 1;
        maxActiveSpecTrace = Math.max(maxActiveSpecTrace, activeSpecTrace);
      }
      order.push(`start:${String(params.id ?? params.other)}`);
      await new Promise((resolve) => setTimeout(resolve, 1));

      if (isSpecTrace) {
        activeSpecTrace -= 1;
      }
      order.push(`end:${String(params.id ?? params.other)}`);
    };
    const batch = [
      specTraceRow("st1"),
      row({
        id: "42",
        event_name: "github.pull_request.opened",
        params: { other: "pr" },
      }),
      specTraceRow("st2"),
    ];
    const { deps: d } = drainDeps([batch], handler, rec);

    expect(await drainOnce(d)).toBe(3);
    expect(maxActiveSpecTrace).toBe(1);
    expect(order.indexOf("end:st1")).toBeLessThan(order.indexOf("start:st2"));
    expect([...rec.done].sort()).toEqual(["42", "st1", "st2"]);
  });

  it("a drain overlapping a running spec_trace handler excludes the family from its claim", async () => {
    const rec = recorder();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler: EventHandler = async () => blocked;
    const { deps: d, excludesSeen } = drainDeps(
      [[specTraceRow("st1")], [], []],
      handler,
      rec,
    );
    const firstDrain = drainOnce(d);

    await new Promise((resolve) => setTimeout(resolve, 1));
    await drainOnce(d);
    release();
    await firstDrain;
    await drainOnce(d);

    expect(excludesSeen).toEqual([[], ["internal.ingest.spec_trace"], []]);
  });

  it("clears the busy family when the serial handler throws", async () => {
    const rec = recorder();
    const throwing: EventHandler = async () => {
      throw new Error("projection failed");
    };
    const { deps: d, excludesSeen } = drainDeps(
      [[specTraceRow("st1")], []],
      throwing,
      rec,
    );

    await drainOnce(d);
    await drainOnce(d);

    expect(excludesSeen).toEqual([[], []]);
    expect(rec.failed).toHaveLength(1);
  });

  it("releases the family slot when a serial handler never settles, instead of starving the family", async () => {
    const rec = recorder();
    const hanging: EventHandler = () => new Promise(() => {});
    const { deps: d, excludesSeen } = drainDeps(
      [[specTraceRow("st1")], []],
      hanging,
      rec,
    );

    await drainOnce({ ...d, serialDeadlineMs: 5 });
    await drainOnce({ ...d, serialDeadlineMs: 5 });

    // the second drain's claim no longer excludes the family — the deadline
    // released the slot (the hung row itself is the reaper's to re-queue)
    expect(excludesSeen).toEqual([[], []]);
    expect(rec.done).toEqual([]);
  });
});
