import { describe, it, expect } from "vitest";
import {
  readAgentLogs,
  pickLatestPod,
  podSelectorForJob,
  entryText,
  podLogFilter,
  assembleArchivedLog,
  type PodLogSource,
  type PodLogArchive,
  type PodSummary,
  type AgentPodInfo,
} from "./agent-pod-logs.js";

/** In-memory PodLogArchive — the durable-store double keyed by Job name. */
class FakePodLogArchive implements PodLogArchive {
  seenTail?: number;

  constructor(private readonly byJob: Record<string, string>) {}

  logsForJob(
    jobName: string,
    opts: { tailLines?: number } = {},
  ): Promise<string | null> {
    this.seenTail = opts.tailLines;

    return Promise.resolve(jobName in this.byJob ? this.byJob[jobName] : null);
  }
}

/** In-memory PodLogSource — the behavioral double (no mocks; real data). */
class FakePodLogSource implements PodLogSource {
  constructor(
    private readonly agents: Record<string, AgentPodInfo | null>,
    private readonly pods: Record<string, PodSummary[]>,
    private readonly logs: Record<string, string>,
  ) {}

  agentInfo(name: string): Promise<AgentPodInfo | null> {
    return Promise.resolve(name in this.agents ? this.agents[name] : null);
  }

  podsForJob(jobName: string): Promise<PodSummary[]> {
    return Promise.resolve(this.pods[jobName] ?? []);
  }

  podLog(podName: string, tailLines?: number): Promise<string> {
    const full = this.logs[podName] ?? "";

    if (tailLines === undefined) {
      return Promise.resolve(full);
    }

    return Promise.resolve(full.split("\n").slice(-tailLines).join("\n"));
  }
}

describe("podSelectorForJob", () => {
  it("returns the job-name label selector", () => {
    expect(podSelectorForJob("05fc5491-review-job")).toBe(
      "job-name=05fc5491-review-job",
    );
  });
});

describe("pickLatestPod", () => {
  it("returns null for an empty pod list", () => {
    expect(pickLatestPod([])).toBeNull();
  });

  it("returns the pod with the newest creationTimestamp", () => {
    const older: PodSummary = {
      name: "pod-old",
      creationTimestamp: "2026-07-15T09:00:00.000Z",
    };
    const newer: PodSummary = {
      name: "pod-new",
      creationTimestamp: "2026-07-15T10:00:00.000Z",
    };

    expect(pickLatestPod([older, newer])).toEqual(newer);
  });
});

describe("readAgentLogs", () => {
  it("returns available logs for a running agent with a job pod", async () => {
    const source = new FakePodLogSource(
      { "05fc5491-review": { phase: "Running", jobName: "job-review" } },
      {
        "job-review": [
          { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
        ],
      },
      { "pod-review": "tool_use: gh pr view\nassistant: looks good" },
    );

    const result = await readAgentLogs(source, "05fc5491-review");

    expect(result).toEqual({
      available: true,
      logs: "tool_use: gh pr view\nassistant: looks good",
      phase: "Running",
      podName: "pod-review",
    });
  });

  it("returns reason no-agent when the Agent CR does not exist", async () => {
    const source = new FakePodLogSource({}, {}, {});

    const result = await readAgentLogs(source, "missing-node");

    expect(result).toMatchObject({ available: false, reason: "no-agent" });
  });

  it("returns reason no-job when the Agent CR has no jobName yet", async () => {
    const source = new FakePodLogSource(
      { "05fc5491-plan": { phase: "Pending", jobName: null } },
      {},
      {},
    );

    const result = await readAgentLogs(source, "05fc5491-plan");

    expect(result).toMatchObject({
      available: false,
      reason: "no-job",
      phase: "Pending",
    });
  });

  it("returns reason no-pod when the job's pod was garbage-collected", async () => {
    const source = new FakePodLogSource(
      { "05fc5491-review": { phase: "Succeeded", jobName: "job-review" } },
      { "job-review": [] },
      {},
    );

    const result = await readAgentLogs(source, "05fc5491-review");

    expect(result).toMatchObject({
      available: false,
      reason: "no-pod",
      phase: "Succeeded",
    });
  });

  it("passes tailLines through to the pod log read", async () => {
    const source = new FakePodLogSource(
      { "05fc5491-review": { phase: "Running", jobName: "job-review" } },
      {
        "job-review": [
          { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
        ],
      },
      { "pod-review": "line1\nline2\nline3" },
    );

    const result = await readAgentLogs(source, "05fc5491-review", {
      tailLines: 2,
    });

    expect(result.logs).toBe("line2\nline3");
  });

  it("returns reason no-pod when the pod is GC-ed during the read (404)", async () => {
    const source: PodLogSource = {
      agentInfo: () =>
        Promise.resolve({ phase: "Running", jobName: "job-review" }),
      podsForJob: () =>
        Promise.resolve([
          { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
        ]),
      podLog: () => Promise.reject({ code: 404 }),
    };

    const result = await readAgentLogs(source, "05fc5491-review");

    expect(result).toMatchObject({ available: false, reason: "no-pod" });
  });

  it("rethrows a non-404 Kubernetes error (e.g. RBAC 403)", async () => {
    const source: PodLogSource = {
      agentInfo: () =>
        Promise.resolve({ phase: "Running", jobName: "job-review" }),
      podsForJob: () => Promise.reject({ code: 403 }),
      podLog: () => Promise.resolve(""),
    };

    await expect(readAgentLogs(source, "05fc5491-review")).rejects.toEqual({
      code: 403,
    });
  });
});

describe("readAgentLogs with a durable archive fallback", () => {
  const gcAgent = {
    "05fc5491-review": { phase: "Succeeded", jobName: "job-review" },
  };

  it("serves archived logs when the node's pod is gone (empty pod list)", async () => {
    const source = new FakePodLogSource(gcAgent, { "job-review": [] }, {});
    const archive = new FakePodLogArchive({
      "job-review": "retained line 1\nretained line 2",
    });

    const result = await readAgentLogs(source, "05fc5491-review", {}, archive);

    expect(result).toEqual({
      available: true,
      logs: "retained line 1\nretained line 2",
      phase: "Succeeded",
      podName: null,
      archived: true,
    });
  });

  it("serves archived logs when the pod is GC-ed during the read (404)", async () => {
    const source: PodLogSource = {
      agentInfo: () =>
        Promise.resolve({ phase: "Failed", jobName: "job-review" }),
      podsForJob: () =>
        Promise.resolve([
          { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
        ]),
      podLog: () => Promise.reject({ code: 404 }),
    };
    const archive = new FakePodLogArchive({ "job-review": "retained tail" });

    const result = await readAgentLogs(source, "05fc5491-review", {}, archive);

    expect(result).toMatchObject({
      available: true,
      archived: true,
      logs: "retained tail",
      podName: null,
    });
  });

  it("falls through to no-pod when nothing is retained for the job", async () => {
    const source = new FakePodLogSource(gcAgent, { "job-review": [] }, {});
    const archive = new FakePodLogArchive({});

    const result = await readAgentLogs(source, "05fc5491-review", {}, archive);

    expect(result).toMatchObject({
      available: false,
      reason: "no-pod",
      phase: "Succeeded",
    });
  });

  it("forwards tailLines to the archive read", async () => {
    const source = new FakePodLogSource(gcAgent, { "job-review": [] }, {});
    const archive = new FakePodLogArchive({ "job-review": "x" });

    await readAgentLogs(source, "05fc5491-review", { tailLines: 42 }, archive);

    expect(archive.seenTail).toBe(42);
  });

  it("does not consult the archive while the pod is still live", async () => {
    const source = new FakePodLogSource(
      { "05fc5491-review": { phase: "Running", jobName: "job-review" } },
      {
        "job-review": [
          { name: "pod-review", creationTimestamp: "2026-07-15T10:00:00.000Z" },
        ],
      },
      { "pod-review": "live output" },
    );
    const archive = new FakePodLogArchive({ "job-review": "stale archive" });

    const result = await readAgentLogs(source, "05fc5491-review", {}, archive);

    expect(result).toMatchObject({ available: true, logs: "live output" });
    expect(archive.seenTail).toBeUndefined();
  });
});

describe("entryText", () => {
  it("returns the textPayload when present", () => {
    expect(entryText({ textPayload: "plain stdout line" })).toBe(
      "plain stdout line",
    );
  });

  it("returns jsonPayload.message when there is no textPayload", () => {
    expect(entryText({ jsonPayload: { message: "structured line" } })).toBe(
      "structured line",
    );
  });

  it("stringifies a jsonPayload that has no message string", () => {
    expect(entryText({ jsonPayload: { level: "info" } })).toBe(
      '{"level":"info"}',
    );
  });

  it("returns empty string for an entry with no payload", () => {
    expect(entryText({})).toBe("");
  });
});

describe("assembleArchivedLog", () => {
  it("returns null when there are no entries", () => {
    expect(assembleArchivedLog([])).toBeNull();
  });

  it("reverses newest-first entries into chronological text", () => {
    expect(
      assembleArchivedLog([
        { textPayload: "third" },
        { textPayload: "second" },
        { textPayload: "first" },
      ]),
    ).toBe("first\nsecond\nthird");
  });
});

describe("podLogFilter", () => {
  it("composes the k8s_container filter for a namespace and job", () => {
    expect(podLogFilter("ai-agents", "job-review")).toBe(
      'resource.type="k8s_container" resource.labels.namespace_name="ai-agents" labels."k8s-pod/job-name"="job-review"',
    );
  });
});
