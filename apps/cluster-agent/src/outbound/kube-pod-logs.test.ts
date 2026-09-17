import { describe, expect, it } from "vitest";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import {
  failedInitContainer,
  KubePodLogs,
  podFailureCause,
} from "./kube-pod-logs.js";

function podWithFailedInitAndAgentStillInitializing(): V1Pod {
  return {
    status: {
      initContainerStatuses: [
        { name: "init", state: { terminated: { exitCode: 1 } } },
      ],
      containerStatuses: [
        { name: "agent", state: { waiting: { reason: "PodInitializing" } } },
      ],
    },
  } as V1Pod;
}

function podWithSucceededInit(): V1Pod {
  return {
    status: {
      initContainerStatuses: [
        { name: "init", state: { terminated: { exitCode: 0 } } },
      ],
      containerStatuses: [
        { name: "agent", state: { terminated: { exitCode: 0 } } },
      ],
    },
  } as V1Pod;
}

function podWithInitStillRunning(): V1Pod {
  return {
    status: {
      initContainerStatuses: [{ name: "init", state: { running: {} } }],
    },
  } as V1Pod;
}

describe("failedInitContainer", () => {
  it("names the init container that exited 1, which is where a dead run's cause is", () => {
    expect(
      failedInitContainer(podWithFailedInitAndAgentStillInitializing()),
    ).toBe("init");
  });

  it("returns undefined when the init container exited 0", () => {
    expect(failedInitContainer(podWithSucceededInit())).toBeUndefined();
  });

  it("returns undefined while the init container is still running", () => {
    expect(failedInitContainer(podWithInitStillRunning())).toBeUndefined();
  });

  it("returns undefined for a pod with no init containers", () => {
    expect(failedInitContainer({ status: {} } as V1Pod)).toBeUndefined();
  });
});

const INIT_LOG = "error: pathspec 'lore/x' did not match any file(s)";

function apiReading(pod: V1Pod): CoreV1Api {
  return {
    readNamespacedPod: () => Promise.resolve(pod),
    readNamespacedPodLog: (req: { container?: string }) =>
      Promise.resolve(req.container === "init" ? INIT_LOG : "agent-log"),
  } as unknown as CoreV1Api;
}

describe("KubePodLogs.podLog", () => {
  it("returns the init container's log when init failed, since agent never started", async () => {
    const logs = new KubePodLogs(() =>
      apiReading(podWithFailedInitAndAgentStillInitializing()),
    );

    expect(await logs.podLog("agent-job-x-abc")).toBe(INIT_LOG);
  });

  it("returns the default container's log when the init container exited 0", async () => {
    const logs = new KubePodLogs(() => apiReading(podWithSucceededInit()));

    expect(await logs.podLog("agent-job-x-abc")).toBe("agent-log");
  });
});

const CLONE_REFUSED_LOG = [
  '{"kind":"lifecycle","phase":"init","status":"started"}',
  '{"kind":"lifecycle","phase":"init","status":"running","tool":"git"}',
  "Cloning into '/workspace/target'...",
  "remote: Repository not found.",
  "fatal: repository 'https://github.com/re-cinq/Otto.git/' not found",
  '[init] git step failed (exit 128): git -c credential.helper= -c credential.helper=!f() { test "$1" = get || exit 0; curl -fsS "$AGENT_GIT_CREDENTIAL_URL"; }; f clone -- https://github.com/re-cinq/Otto.git /workspace/target',
  '{"kind":"lifecycle","exitCode":128,"phase":"init","status":"failed","tool":"git"}',
].join("\n");

function podWithInitExit(exitCode: number): V1Pod {
  return {
    status: {
      initContainerStatuses: [
        { name: "init", state: { terminated: { exitCode, reason: "Error" } } },
      ],
    },
  } as V1Pod;
}

describe("podFailureCause", () => {
  it("names the init container, its exit code and git's own words for a refused clone", () => {
    expect(podFailureCause(podWithInitExit(128), CLONE_REFUSED_LOG)).toBe(
      "init container \"init\" exited 128: Cloning into '/workspace/target'... remote: Repository not found. fatal: repository 'https://github.com/re-cinq/Otto.git/' not found",
    );
  });

  it("names an OOMKilled agent container even when its log is only JSON", () => {
    const pod = {
      status: {
        containerStatuses: [
          {
            name: "agent",
            state: { terminated: { exitCode: 137, reason: "OOMKilled" } },
          },
        ],
      },
    } as V1Pod;

    expect(podFailureCause(pod, '{"type":"system"}')).toBe(
      'container "agent" was OOMKilled (exit 137)',
    );
  });

  it("returns undefined for a failed container whose log holds no plain line", () => {
    expect(
      podFailureCause(podWithInitExit(1), '{"kind":"lifecycle"}'),
    ).toBeUndefined();
  });

  it("returns undefined for a pod with no failed container", () => {
    expect(podFailureCause(podWithSucceededInit(), "done")).toBeUndefined();
  });

  it("redacts a token a failing step printed", () => {
    expect(
      podFailureCause(
        podWithInitExit(1),
        "fatal: https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r",
      ),
    ).not.toContain("ghs_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

function apiListing(pods: V1Pod[], logs: Record<string, string>): CoreV1Api {
  return {
    listNamespacedPod: (req: { labelSelector?: string }) =>
      Promise.resolve({
        items: req.labelSelector === "job-name=agent-job-x" ? pods : [],
      }),
    readNamespacedPodLog: (req: { name: string; container?: string }) =>
      Promise.resolve(logs[`${req.name}/${req.container}`] ?? ""),
  } as unknown as CoreV1Api;
}

function named(pod: V1Pod, name: string, createdAt: string): V1Pod {
  return {
    ...pod,
    metadata: { name, creationTimestamp: new Date(createdAt) },
  } as V1Pod;
}

describe("KubePodLogs.failureCause", () => {
  it("reads the newest pod's failed init container and names the refused clone", async () => {
    const logs = new KubePodLogs(() =>
      apiListing(
        [
          named(podWithInitExit(1), "old", "2026-09-17T14:00:00Z"),
          named(podWithInitExit(128), "new", "2026-09-17T14:15:00Z"),
        ],
        { "new/init": CLONE_REFUSED_LOG, "old/init": "stale failure" },
      ),
    );

    expect(await logs.failureCause("agent-job-x")).toContain(
      'init container "init" exited 128: ',
    );
  });

  it("returns undefined when the Job's pods are already gone", async () => {
    const logs = new KubePodLogs(() => apiListing([], {}));

    expect(await logs.failureCause("agent-job-x")).toBeUndefined();
  });
});
