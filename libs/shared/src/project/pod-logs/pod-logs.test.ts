import { describe, it, expect } from "vitest";
import { InMemoryPodLogs } from "./pod-logs-memory.js";
import { storedPodLogArchive } from "./stored-pod-log-archive.js";

const chunk = (seq: number, lines: string, pod = "pod-1") => ({
  agentCrName: "run12-review",
  jobName: "job-1",
  podName: pod,
  seq,
  lines,
});

describe("InMemoryPodLogs", () => {
  it("returns a job's chunks in the order its pod emitted them, not arrival order", async () => {
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(2, "second\n"), chunk(1, "first\n")]);

    expect((await store.listForJob("job-1")).map((row) => row.lines)).toEqual([
      "first\n",
      "second\n",
    ]);
  });

  it("collapses a redelivered chunk, because the producer retries through the proxy", async () => {
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(1, "hello\n")]);
    await store.appendBatch([chunk(1, "hello\n")]);

    expect(await store.listForJob("job-1")).toHaveLength(1);
  });

  it("keeps the same seq from a different pod, since seq is per pod not per job", async () => {
    // A retried node runs a second pod under the same Job. Both start at seq 1,
    // and collapsing them would silently discard the retry's output.
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(1, "attempt one\n", "pod-1")]);
    await store.appendBatch([chunk(1, "attempt two\n", "pod-2")]);

    expect(await store.listForJob("job-1")).toHaveLength(2);
  });

  it("keeps each pod's chunks together instead of interleaving two attempts by seq", async () => {
    // Ordering by seq ALONE reads pod-1 seq1, pod-2 seq1, pod-1 seq2 … — two
    // attempts shuffled into each other, which is worse than either alone.
    // Pods are ordered by when they first appear, so a retry reads after the
    // attempt it replaced rather than alphabetically by pod name.
    const store = new InMemoryPodLogs();

    await store.appendBatch([
      chunk(1, "one-a\n", "pod-b"),
      chunk(2, "one-b\n", "pod-b"),
    ]);
    await store.appendBatch([
      chunk(1, "two-a\n", "pod-a"),
      chunk(2, "two-b\n", "pod-a"),
    ]);

    expect((await store.listForJob("job-1")).map((row) => row.lines)).toEqual([
      "one-a\n",
      "one-b\n",
      "two-a\n",
      "two-b\n",
    ]);
  });

  it("returns nothing for a job it holds no chunks for", async () => {
    expect(await new InMemoryPodLogs().listForJob("job-absent")).toEqual([]);
  });

  it("prunes rows past the retention window and reports the count", async () => {
    const store = new InMemoryPodLogs(() => new Date("2026-08-28T00:00:00Z"));
    const old = new InMemoryPodLogs(() => new Date("2026-08-01T00:00:00Z"));

    await old.appendBatch([chunk(1, "ancient\n")]);
    await store.appendBatch([chunk(1, "recent\n")]);

    expect({
      pruned: await store.pruneOld(14),
      left: (await store.listForJob("job-1")).length,
    }).toEqual({ pruned: 0, left: 1 });
  });
});

describe("storedPodLogArchive", () => {
  it("reassembles a job's chunks into one log, so the archive seam sees a pod's stdout", async () => {
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(1, "line one\n"), chunk(2, "line two\n")]);

    expect(await storedPodLogArchive(store).logsForJob("job-1")).toBe(
      "line one\nline two\n",
    );
  });

  it("returns null when nothing is stored, so the next archive in the chain is tried", async () => {
    expect(
      await storedPodLogArchive(new InMemoryPodLogs()).logsForJob("job-1"),
    ).toBeNull();
  });

  it("keeps blank lines inside the tail, which in a stack trace are content", async () => {
    // Filtering every falsy line to drop the trailing newline's empty element
    // also strips the blank lines WITHIN the log, silently reflowing a stack
    // trace or a diff into something that never appeared on stdout.
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(1, "Error: boom\n\n  at frame\n")]);

    expect(
      await storedPodLogArchive(store).logsForJob("job-1", { tailLines: 3 }),
    ).toBe("Error: boom\n\n  at frame");
  });

  it("returns only the last N lines when a tail is asked for", async () => {
    const store = new InMemoryPodLogs();

    await store.appendBatch([chunk(1, "a\nb\n"), chunk(2, "c\nd\n")]);

    expect(
      await storedPodLogArchive(store).logsForJob("job-1", { tailLines: 2 }),
    ).toBe("c\nd");
  });
});
