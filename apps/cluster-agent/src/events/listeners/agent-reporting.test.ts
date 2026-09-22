import { describe, it, expect } from "vitest";
import type { ProxyMessage } from "@re-cinq/lore-shared/project/events/event-input-port.js";
import { reportForAgent } from "./agent-reporting.js";

const TASK = "lore.re-cinq.com/task-id";

describe("reportForAgent", () => {
  it("reports a terminal Agent CR as its kubernetes event", async () => {
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Succeeded" },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
      },
    );

    expect(reported).toEqual([
      {
        kind: "event",
        event: {
          eventName: "kubernetes.agent.succeeded",
          source: "kubernetes",
          params: {
            taskId: "task-1",
            agentName: "cr-1",
            phase: "Succeeded",
            status: { phase: "Succeeded" },
          },
          dedupeKey: "k8s:task-1:Succeeded",
        },
      },
    ]);
  });

  it("reports nothing for a CR that has not reached a terminal phase", async () => {
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Running" },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
      },
    );

    expect(reported).toEqual([]);
  });

  it("carries the failed pod's own words as errorText beside the Job-level reason", async () => {
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: {
          phase: "Failed",
          jobName: "agent-job-cr-1",
          failureReason:
            "BackoffLimitExceeded: Job has reached the specified backoff limit",
        },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
        failureCause: async (jobName) =>
          jobName === "agent-job-cr-1"
            ? 'init container "init" exited 128: remote: Repository not found.'
            : undefined,
      },
    );

    expect(reported[0]).toMatchObject({
      event: {
        params: {
          status: {
            failureReason:
              "BackoffLimitExceeded: Job has reached the specified backoff limit",
            errorText:
              'init container "init" exited 128: remote: Repository not found.',
          },
        },
      },
    });
  });

  it("still reports a failed Agent whose pod cannot be read", async () => {
    const reported: ProxyMessage[] = [];

    await reportForAgent(
      {
        metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
        status: { phase: "Failed", jobName: "agent-job-cr-1" },
      } as never,
      {
        emit: async (message) => {
          reported.push(message);
        },
        failureCause: async () => {
          throw new Error("pods is forbidden");
        },
      },
    );

    expect(reported).toMatchObject([
      { event: { params: { status: { phase: "Failed" } } } },
    ]);
  });

  it("swallows a failed emit so one bad CR cannot end the watch", async () => {
    const failing = {
      emit: async (): Promise<void> => {
        throw new Error("proxy refused the message");
      },
    };

    await expect(
      reportForAgent(
        {
          metadata: { name: "cr-1", labels: { [TASK]: "task-1" } },
          status: { phase: "Failed" },
        } as never,
        failing,
      ),
    ).resolves.toBeUndefined();
  });
});
