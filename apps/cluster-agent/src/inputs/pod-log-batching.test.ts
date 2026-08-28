import { describe, it, expect } from "vitest";
import {
  addLine,
  drain,
  emptyBatch,
  followableAgents,
  pickPodToFollow,
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

  it("flushes early once accumulated bytes reach the cap, even when no single line exceeds it", () => {
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

describe("pickPodToFollow", () => {
  const pod = (name: string, created: string, containers: string[]) => ({
    metadata: { name, creationTimestamp: created },
    spec: { containers: containers.map((c) => ({ name: c })) },
  });

  it("names the container to stream, because an empty one is a 400 from the API", () => {
    // Found live: `Log.log(ns, pod, "", ...)` sends `?container=` and the
    // apiserver answers 400 "Error occurred in log request". An agent pod has
    // two containers (`init`, `agent`), so the choice cannot be left implicit.
    expect(
      pickPodToFollow([
        pod("agent-job-x-1", "2026-08-29T00:00:00Z", ["agent"]),
      ]),
    ).toEqual({ podName: "agent-job-x-1", containerName: "agent" });
  });

  it("takes the newest pod, so a retried node streams its current attempt", () => {
    expect(
      pickPodToFollow([
        pod("older", "2026-08-29T00:00:00Z", ["agent"]),
        pod("newer", "2026-08-29T01:00:00Z", ["agent"]),
      ])?.podName,
    ).toBe("newer");
  });

  it("takes the FIRST container, which is the workload rather than a sidecar", () => {
    expect(
      pickPodToFollow([pod("p", "2026-08-29T00:00:00Z", ["agent", "sidecar"])])
        ?.containerName,
    ).toBe("agent");
  });

  it("orders by a Date timestamp too, which is what the real client hands back", () => {
    // V1Pod.metadata.creationTimestamp is a Date, not the string a fixture
    // naturally writes. Comparing Dates as strings would sort them by
    // "[object Date]" — every pod equal, newest by accident.
    expect(
      pickPodToFollow([
        {
          metadata: {
            name: "older",
            creationTimestamp: new Date("2026-08-29T00:00:00Z"),
          },
          spec: { containers: [{ name: "agent" }] },
        },
        {
          metadata: {
            name: "newer",
            creationTimestamp: new Date("2026-08-29T02:00:00Z"),
          },
          spec: { containers: [{ name: "agent" }] },
        },
      ])?.podName,
    ).toBe("newer");
  });

  it("sorts a pod carrying no timestamp last, rather than letting it win by accident", () => {
    // A pod observed between creation and the apiserver stamping it has none.
    // Treating that as the empty string sorts it oldest, so a pod with a real
    // timestamp is preferred — the opposite would follow the least-known pod.
    expect(
      pickPodToFollow([
        {
          metadata: { name: "unstamped" },
          spec: { containers: [{ name: "agent" }] },
        },
        {
          metadata: {
            name: "stamped",
            creationTimestamp: "2026-08-29T00:00:00Z",
          },
          spec: { containers: [{ name: "agent" }] },
        },
      ])?.podName,
    ).toBe("stamped");
  });

  it("returns null when there is no pod yet, so discovery simply retries", () => {
    expect(pickPodToFollow([])).toBeNull();
  });

  it("returns null for a pod with no name or no container, rather than streaming an empty one", () => {
    expect({
      noName: pickPodToFollow([
        {
          metadata: { creationTimestamp: "x" },
          spec: { containers: [{ name: "agent" }] },
        },
      ]),
      noContainer: pickPodToFollow([
        { metadata: { name: "p" }, spec: { containers: [] } },
      ]),
      noSpec: pickPodToFollow([{ metadata: { name: "p" } }]),
    }).toEqual({ noName: null, noContainer: null, noSpec: null });
  });
});
