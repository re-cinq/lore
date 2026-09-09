import { describe, expect, it } from "vitest";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import { failedInitContainer, KubePodLogs } from "./kube-pod-logs.js";

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
