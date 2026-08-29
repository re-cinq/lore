import { describe, expect, it } from "vitest";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import {
  CLAIM_MAX_IDLE_DELAY_MS,
  claimIntervalMs,
  claimOnce,
  releaseClaim,
  stopLatch,
  nextClaimDelay,
  runClaimLoop,
  type ClaimOutcome,
} from "./claim-loop.js";

const IDENTITY = { id: "agent-id-1", token: "per-agent-token" };

const CLAIM_BODY = {
  station_run_id: "run-42",
  node_row_id: "7",
  assembly_run_id: "asm-1",
  node_id: "implement",
  iteration: 0,
  agent_cr_name: "abc123def456-implement",
  spec: {
    taskId: "task-1",
    taskType: "implementation",
    description: "implement the thing",
    prompt: "do it",
    targetRepo: "re-cinq/lore",
    branch: "feat/thing",
  } satisfies LoreTaskSpec,
};

const jsonResponse = (status: number, body?: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as Response;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(responses: Array<Response | Error>): {
  fetchFn: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? new Error("fake fetch exhausted");

    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

describe("claimIntervalMs", () => {
  it("defaults to 15 seconds", () => {
    expect(claimIntervalMs({})).toBe(15_000);
  });

  it("reads LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S as seconds", () => {
    expect(claimIntervalMs({ LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S: "5" })).toBe(
      5_000,
    );
  });

  it("falls back to 15 seconds on a non-numeric value", () => {
    expect(
      claimIntervalMs({ LORE_CLUSTER_AGENT_CLAIM_INTERVAL_S: "soon" }),
    ).toBe(15_000);
  });
});

describe("nextClaimDelay", () => {
  it("keeps the base interval on the first empty, then doubles to the 60s ceiling", () => {
    expect(nextClaimDelay(15_000, 0, "empty")).toBe(15_000);
    expect(nextClaimDelay(15_000, 1, "empty")).toBe(30_000);
    expect(nextClaimDelay(15_000, 2, "empty")).toBe(60_000);
    expect(nextClaimDelay(15_000, 3, "empty")).toBe(CLAIM_MAX_IDLE_DELAY_MS);
  });

  it("resets to the base interval on a successful claim", () => {
    expect(nextClaimDelay(15_000, 4, "claimed")).toBe(15_000);
  });

  it("keeps the base interval after an error", () => {
    expect(nextClaimDelay(15_000, 4, "error")).toBe(15_000);
  });
});

describe("claimOnce", () => {
  const deps = (
    responses: Array<Response | Error>,
    launch?: (spec: LoreTaskSpec) => Promise<{ ref: string }>,
  ) => {
    const { fetchFn, calls } = fakeFetch(responses);
    const launched: LoreTaskSpec[] = [];

    return {
      calls,
      launched,
      tick: {
        apiUrl: "https://lore-api.example.com",
        identity: () => IDENTITY,
        launch:
          launch ??
          ((spec: LoreTaskSpec) => {
            launched.push(spec);

            return Promise.resolve({ ref: spec.name ?? "cr" });
          }),
        fetchFn,
      },
    };
  };

  it("posts the claim under the per-agent bearer token", async () => {
    const d = deps([jsonResponse(204)]);

    await claimOnce(d.tick);

    expect(d.calls[0].url).toBe(
      "https://lore-api.example.com/api/cluster-agents/agent-id-1/claim",
    );
    expect(d.calls[0].init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer per-agent-token" },
    });
  });

  it("reports empty on a 204", async () => {
    expect(await claimOnce(deps([jsonResponse(204)]).tick)).toEqual({
      kind: "empty",
    });
  });

  it("launches the claimed spec under the Floor's recorded Agent CR name", async () => {
    const d = deps([jsonResponse(200, CLAIM_BODY)]);

    expect(await claimOnce(d.tick)).toEqual({
      kind: "claimed",
      stationRunId: "run-42",
      crName: "abc123def456-implement",
    });
    expect(d.launched).toEqual([
      { ...CLAIM_BODY.spec, name: "abc123def456-implement" },
    ]);
  });

  it("falls back to the spec's own name for a row with none recorded", async () => {
    const named = {
      ...CLAIM_BODY,
      agent_cr_name: null,
      spec: { ...CLAIM_BODY.spec, name: "explicit-name" },
    };
    const d = deps([jsonResponse(200, named)]);

    await claimOnce(d.tick);

    expect(d.launched[0].name).toBe("explicit-name");
  });

  it("refuses to launch when the row and the spec name different CRs", async () => {
    const disagreeing = {
      ...CLAIM_BODY,
      spec: { ...CLAIM_BODY.spec, name: "some-other-name" },
    };
    const d = deps([jsonResponse(200, disagreeing)]);

    expect(await claimOnce(d.tick)).toEqual({
      kind: "error",
      message:
        "claim for station run run-42 disagrees about its CR name: row says abc123def456-implement, spec says some-other-name — refusing a launch nothing could correlate",
    });
    expect(d.launched).toEqual([]);
  });

  it("reports unauthorized on a 401", async () => {
    expect(await claimOnce(deps([jsonResponse(401)]).tick)).toEqual({
      kind: "unauthorized",
    });
  });

  it("reports unauthorized on a 403", async () => {
    expect(await claimOnce(deps([jsonResponse(403)]).tick)).toEqual({
      kind: "unauthorized",
    });
  });

  it("hands the visit back and reports an error when the launch throws", async () => {
    const d = deps(
      [
        jsonResponse(200, CLAIM_BODY),
        jsonResponse(200, { status: "requeued" }),
      ],
      () => Promise.reject(new Error("apiserver unreachable")),
    );

    expect(await claimOnce(d.tick)).toEqual({
      kind: "error",
      message:
        "launch failed for station run run-42, visit handed back: apiserver unreachable",
    });
    expect(d.calls[1]?.url).toBe(
      "https://lore-api.example.com/api/cluster-agents/agent-id-1/release",
    );
  });

  it("reports already-running when the CR was already there", async () => {
    const d = deps([jsonResponse(200, CLAIM_BODY)], () =>
      Promise.resolve({ ref: "abc123def456-implement", launched: false }),
    );

    expect(await claimOnce(d.tick)).toEqual({
      kind: "already-running",
      stationRunId: "run-42",
      crName: "abc123def456-implement",
    });
  });

  it("reports an error on an unexpected HTTP 500", async () => {
    expect(await claimOnce(deps([jsonResponse(500)]).tick)).toEqual({
      kind: "error",
      message: "claim refused (HTTP 500)",
    });
  });

  it("reports an error when the claim fetch rejects", async () => {
    expect(await claimOnce(deps([new Error("ECONNRESET")]).tick)).toMatchObject(
      { kind: "error" },
    );
  });

  it("reports an error, without throwing, when a 200 body is not JSON", async () => {
    const broken = {
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    } as Response;

    expect(await claimOnce(deps([broken]).tick)).toEqual({
      kind: "error",
      message: "claim response parse failed: Unexpected token < in JSON",
    });
  });
});

describe("runClaimLoop", () => {
  const loop = (outcomes: ClaimOutcome[]) => {
    const sleeps: number[] = [];
    const reRegistrations: number[] = [];
    let tick = 0;

    return {
      sleeps,
      reRegistrations,
      run: () =>
        runClaimLoop({
          claim: () => Promise.resolve(outcomes[tick++]),
          reRegister: () => {
            reRegistrations.push(tick);

            return Promise.resolve(IDENTITY);
          },
          sleep: (ms) => {
            sleeps.push(ms);

            return Promise.resolve();
          },
          baseDelayMs: 15_000,
          running: () => tick < outcomes.length,
          log: () => {},
        }),
    };
  };

  it("holds the base sleep on the first empty, doubles across consecutive ones, and resets after a hit", async () => {
    const l = loop([
      { kind: "empty" },
      { kind: "empty" },
      { kind: "empty" },
      { kind: "claimed", stationRunId: "run-1", crName: "cr-1" },
      { kind: "empty" },
    ]);

    await l.run();

    expect(l.sleeps).toEqual([15_000, 30_000, 60_000, 15_000, 15_000]);
  });

  it("re-registers on unauthorized and keeps polling at the base interval", async () => {
    const l = loop([{ kind: "unauthorized" }, { kind: "empty" }]);

    await l.run();

    expect(l.reRegistrations).toEqual([1]);
    expect(l.sleeps).toEqual([15_000, 15_000]);
  });

  it("continues at the base interval after a launch error", async () => {
    const l = loop([
      { kind: "error", message: "launch failed for station run run-9: boom" },
      { kind: "empty" },
    ]);

    await l.run();

    expect(l.sleeps).toEqual([15_000, 15_000]);
  });
});

describe("releasing a claim the launch could not honour", () => {
  const IDENTITY = { id: "agent-id-1", token: "per-agent-token" };

  it("hands the visit back under the per-agent token, naming the cause", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });

      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;

    await releaseClaim({
      apiUrl: "https://lore-api.example.com",
      identity: () => IDENTITY,
      nodeRowId: "412",
      reason: "GitHub not configured",
      fetchFn,
    });

    expect(calls).toEqual([
      {
        url: "https://lore-api.example.com/api/cluster-agents/agent-id-1/release",
        body: { node_row_id: "412", reason: "GitHub not configured" },
      },
    ]);
  });

  it("swallows a refused release rather than ending the loop over it", async () => {
    const fetchFn = (() =>
      Promise.reject(new Error("connection reset"))) as unknown as typeof fetch;

    await expect(
      releaseClaim({
        apiUrl: "https://lore-api.example.com",
        identity: () => IDENTITY,
        nodeRowId: "412",
        reason: "boom",
        fetchFn,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("stopLatch", () => {
  it("keeps running until stopped", () => {
    const latch = stopLatch();

    expect(latch.running()).toBe(true);
    latch.stop();
    expect(latch.running()).toBe(false);
  });

  it("ends the claim loop after the tick in flight when shutdown stops it", async () => {
    const latch = stopLatch();
    const claimed: string[] = [];

    await runClaimLoop({
      claim: () => {
        claimed.push("tick");

        return Promise.resolve<ClaimOutcome>({ kind: "empty" });
      },
      reRegister: () => Promise.resolve(null),
      sleep: () => Promise.resolve(),
      baseDelayMs: 15_000,
      running: latch.running,
      log: () => {},
      onOutcome: () => latch.stop(),
    });

    expect(claimed).toEqual(["tick"]);
  });
});
