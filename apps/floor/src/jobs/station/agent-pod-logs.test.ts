import { describe, it, expect } from "vitest";
import {
  readAgentLogs,
  pickLatestPod,
  podSelectorForJob,
  type PodLogSource,
  type PodSummary,
  type AgentPodInfo,
} from "./agent-pod-logs.js";

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
