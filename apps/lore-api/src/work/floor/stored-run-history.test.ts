import { describe, expect, it } from "vitest";
import { InMemoryPodLogs } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-memory.js";
import { storedRunHistory, type StoredRunPorts } from "./stored-run-history.js";

const RUN = "11111111-1111-4111-8111-111111111111";

function ports(over: Partial<StoredRunPorts> = {}): StoredRunPorts {
  return {
    hasRun: (runId) => Promise.resolve(runId === RUN),
    nodeOf: (agentCrName) =>
      Promise.resolve(
        agentCrName === "abc-review"
          ? { assemblyRunId: RUN, status: "running", outcome: "success" }
          : null,
      ),
    turns: {
      listByLine: (runId: string, afterId: string, limit: number) =>
        Promise.resolve([`turns of ${runId} after ${afterId} limit ${limit}`]),
    } as never,
    events: {
      listSince: (runId: string, afterId: string, limit: number) =>
        Promise.resolve([`events of ${runId} after ${afterId} limit ${limit}`]),
    } as never,
    podLogs: new InMemoryPodLogs(),
    ...over,
  };
}

async function withStdout(lines: string): Promise<StoredRunPorts> {
  const podLogs = new InMemoryPodLogs();

  await podLogs.appendBatch([
    {
      agentCrName: "abc-review",
      jobName: "abc-review-job",
      podName: "abc-review-pod",
      seq: 1,
      lines,
    },
  ]);

  return ports({ podLogs });
}

describe("storedRunHistory turns and events", () => {
  it("reads the turns of a run Postgres has, after cursor 40 with limit 201", async () => {
    expect(await storedRunHistory(ports()).turns(RUN, "40", 201)).toEqual([
      `turns of ${RUN} after 40 limit 201`,
    ]);
  });

  it("answers null for the turns of a run Postgres does not have, which is a floor run", async () => {
    expect(await storedRunHistory(ports()).turns("floor-run", "0", 201)).toBe(
      null,
    );
  });

  it("reads the events of a run Postgres has, after cursor 7 with limit 1000", async () => {
    expect(await storedRunHistory(ports()).events(RUN, "7", 1000)).toEqual([
      `events of ${RUN} after 7 limit 1000`,
    ]);
  });

  it("answers null for the events of a run Postgres does not have", async () => {
    expect(await storedRunHistory(ports()).events("floor-run", "0", 1000)).toBe(
      null,
    );
  });
});

describe("storedRunHistory node logs", () => {
  it("answers the stored stdout of abc-review as archived, with the node's outcome as its phase", async () => {
    const history = storedRunHistory(await withStdout("line 1\nline 2\n"));

    expect(await history.nodeLogs(RUN, "abc-review", undefined)).toEqual({
      available: true,
      logs: "line 1\nline 2\n",
      phase: "success",
      podName: null,
      archived: true,
    });
  });

  it("keeps the last 1 line when tail is 1", async () => {
    const history = storedRunHistory(await withStdout("line 1\nline 2\n"));

    expect((await history.nodeLogs(RUN, "abc-review", 1))?.logs).toBe("line 2");
  });

  it("says no-records for a node whose stdout was pruned or never stored", async () => {
    expect(
      await storedRunHistory(ports()).nodeLogs(RUN, "abc-review", undefined),
    ).toEqual({
      available: false,
      logs: null,
      phase: "success",
      podName: null,
      archived: false,
      reason: "no-records",
    });
  });

  it("answers null for a node of another run, so the name of one run cannot read another's log", async () => {
    expect(
      await storedRunHistory(ports()).nodeLogs(
        "22222222-2222-4222-8222-222222222222",
        "abc-review",
        undefined,
      ),
    ).toBe(null);
  });

  it("answers null for a name Postgres has no node for, which is a floor visit", async () => {
    expect(
      await storedRunHistory(ports()).nodeLogs(RUN, "floor-visit-1", undefined),
    ).toBe(null);
  });
});
