import { describe, it, expect } from "vitest";
import { InMemoryPodLogs } from "@re-cinq/lore-shared/project/pod-logs/pod-logs-memory.js";
import { parsePodLogAppended, ingestPodLogChunks } from "./pod-log-ingest.js";

const params = {
  agentCrName: "run12-review",
  jobName: "job-1",
  podName: "pod-1",
  chunks: [
    { seq: 1, lines: "first\n" },
    { seq: 2, lines: "second\n" },
  ],
};

describe("parsePodLogAppended", () => {
  it("reads a well-formed event into chunks ready to store", () => {
    expect(parsePodLogAppended(params)).toEqual([
      {
        agentCrName: "run12-review",
        jobName: "job-1",
        podName: "pod-1",
        seq: 1,
        lines: "first\n",
      },
      {
        agentCrName: "run12-review",
        jobName: "job-1",
        podName: "pod-1",
        seq: 2,
        lines: "second\n",
      },
    ]);
  });

  it("returns nothing for an event missing the identity a chunk is keyed by", () => {
    // Skip-not-fail, the posture every ingest path here takes: a handler that
    // throws sends the delivery round the retry ladder to a dead letter, and a
    // malformed event will be just as malformed on the fifth attempt.
    expect({
      noPod: parsePodLogAppended({ ...params, podName: undefined }),
      noJob: parsePodLogAppended({ ...params, jobName: "" }),
      noChunks: parsePodLogAppended({ ...params, chunks: [] }),
      notAnObject: parsePodLogAppended("nonsense"),
    }).toEqual({ noPod: [], noJob: [], noChunks: [], notAnObject: [] });
  });

  it("drops a chunk whose seq or lines are the wrong shape, keeping the rest", () => {
    expect(
      parsePodLogAppended({
        ...params,
        chunks: [
          { seq: "1", lines: "bad\n" },
          { seq: 2, lines: "good\n" },
        ],
      }).map((chunk) => chunk.lines),
    ).toEqual(["good\n"]);
  });
});

describe("ingestPodLogChunks", () => {
  it("stores what the event carried, so the log outlives its pod", async () => {
    const store = new InMemoryPodLogs();

    await ingestPodLogChunks(params, store);

    expect((await store.listForJob("job-1")).map((row) => row.lines)).toEqual([
      "first\n",
      "second\n",
    ]);
  });

  it("stores nothing for a malformed event rather than failing the delivery", async () => {
    const store = new InMemoryPodLogs();

    await ingestPodLogChunks({ chunks: [] }, store);

    expect(await store.listForJob("job-1")).toEqual([]);
  });
});
