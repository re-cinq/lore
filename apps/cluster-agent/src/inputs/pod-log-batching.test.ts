import { describe, it, expect } from "vitest";
import {
  addLine,
  drain,
  emptyBatch,
  followableAgents,
  podLogEvent,
  type BatchLimits,
} from "./pod-log-batching.js";

const limits: BatchLimits = { maxLines: 3, maxBytes: 64 };

/** Feed lines in, collecting whatever the batcher decided to flush. */
function feed(lines: string[], over: Partial<BatchLimits> = {}) {
  let batch = emptyBatch();
  const flushed: string[] = [];

  for (const line of lines) {
    const step = addLine(batch, line, { ...limits, ...over });

    batch = step.batch;

    if (step.flushed !== null) {
      flushed.push(step.flushed);
    }
  }

  return { batch, flushed };
}

describe("addLine", () => {
  it("holds lines until the line count is reached, then flushes them together", () => {
    const { flushed } = feed(["a", "b", "c"]);

    expect(flushed).toEqual(["a\nb\nc\n"]);
  });

  it("flushes early once the byte cap is reached, so one enormous line cannot grow the batch unbounded", () => {
    const { flushed } = feed(["x".repeat(50), "y".repeat(50)]);

    expect(flushed).toEqual([`${"x".repeat(50)}\n${"y".repeat(50)}\n`]);
  });

  it("keeps a partial batch pending rather than flushing a line at a time", () => {
    const { batch, flushed } = feed(["a", "b"]);

    expect({ flushed, pending: batch.lines }).toEqual({
      flushed: [],
      pending: ["a", "b"],
    });
  });

  it("starts the next batch empty, so a flushed line is never sent twice", () => {
    const { batch } = feed(["a", "b", "c"]);

    expect(batch).toEqual(emptyBatch());
  });

  it("flushes a single line that alone exceeds the byte cap, rather than wedging", () => {
    // A batch that can never satisfy its own limit would hold that line
    // forever. The cap bounds memory; it cannot bound what the pod wrote.
    const { flushed, batch } = feed(["z".repeat(200)]);

    expect({
      flushedCount: flushed.length,
      pending: batch.lines.length,
    }).toEqual({ flushedCount: 1, pending: 0 });
  });
});

describe("drain", () => {
  it("flushes what is pending, so a quiet pod's last lines are not stranded", () => {
    const { batch } = feed(["a", "b"]);

    expect(drain(batch).flushed).toBe("a\nb\n");
  });

  it("flushes nothing when nothing is pending, so an idle tick emits no event", () => {
    expect(drain(emptyBatch()).flushed).toBeNull();
  });
});

describe("podLogEvent", () => {
  it("carries the identity a chunk is keyed by, and dedupes per pod and seq", () => {
    expect(
      podLogEvent(
        { agentCrName: "run12-review", jobName: "job-1", podName: "pod-1" },
        7,
        "a\nb\n",
      ),
    ).toEqual({
      eventName: "kubernetes.pod_log.appended",
      source: "kubernetes",
      params: {
        agentCrName: "run12-review",
        jobName: "job-1",
        podName: "pod-1",
        chunks: [{ seq: 7, lines: "a\nb\n" }],
      },
      dedupeKey: "k8s:podlog:pod-1:7",
    });
  });

  it("dedupes on the POD, not the job, so a retried node's chunks do not collapse", () => {
    // Both pods of a retried node start at seq 1. A job-keyed dedupe would drop
    // the retry's first chunk as a duplicate of the original's.
    const target = { agentCrName: "cr", jobName: "job-1", podName: "pod-2" };

    expect(podLogEvent(target, 1, "x\n").dedupeKey).toBe("k8s:podlog:pod-2:1");
  });
});

describe("followableAgents", () => {
  const cr = (name: string, phase: string, jobName?: string) => ({
    metadata: { name },
    status: { phase, jobName },
  });

  it("follows a running agent that has a pod to follow", () => {
    expect(
      followableAgents([cr("a-1", "Running", "job-1")], new Set()).map(
        (target) => target.agentCrName,
      ),
    ).toEqual(["a-1"]);
  });

  it("skips a terminal agent, whose logs the stored chunks already hold", () => {
    expect(
      followableAgents(
        [cr("a-1", "Succeeded", "job-1"), cr("a-2", "Failed", "job-2")],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("skips an agent with no job yet, since there is no pod to open a stream against", () => {
    expect(followableAgents([cr("a-1", "Pending")], new Set())).toEqual([]);
  });

  it("skips a CR carrying no metadata or status yet, rather than following an empty name", () => {
    // A CR observed between creation and the controller filling its status has
    // neither. Reading through it would put "" in the follower map, which then
    // matches every other nameless CR and follows none of them.
    expect(
      followableAgents(
        [{}, { metadata: {} }, { metadata: { name: "a-1" }, status: {} }],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("skips one already being followed, so a discovery tick does not double every stream", () => {
    // Discovery re-runs on a timer over the same running agents. Without this
    // each tick opens another stream on the same pod, and every line is emitted
    // once per stream — dedupe is per (pod, seq), and two streams assign their
    // own seqs, so the duplicates would NOT collapse.
    expect(
      followableAgents([cr("a-1", "Running", "job-1")], new Set(["a-1"])),
    ).toEqual([]);
  });
});
