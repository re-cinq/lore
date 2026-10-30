import { existsSync } from "node:fs";
import { capture } from "./exec.ts";
import {
  classifyDeployment,
  classifyDockerContainer,
  classifyHttp,
  classifyMinikube,
  type RowStatus,
} from "./health.ts";
import type { Probe, ServiceSpec } from "./services.ts";

const HTTP_TIMEOUT_MS = 1_500;
const COMMAND_TIMEOUT_MS = 4_000;
const DOCKER_STATE_TEMPLATE =
  "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}";

async function httpStatusOf(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    return response.status;
  } catch {
    return null;
  }
}

// Returns null for a probe that has nothing to ask.
export async function probeOnce(
  probe: Probe,
  ageMs: number,
): Promise<RowStatus | null> {
  const options = { timeoutMs: COMMAND_TIMEOUT_MS };

  switch (probe.kind) {
    case "none":
      return null;
    case "http":
      return classifyHttp(await httpStatusOf(probe.url), ageMs);
    case "docker": {
      const inspected = await capture(
        "docker",
        ["inspect", "-f", DOCKER_STATE_TEMPLATE, probe.container],
        options,
      );

      return classifyDockerContainer(inspected.stdout);
    }
    case "minikube": {
      const status = await capture(
        "minikube",
        ["status", "-p", probe.profile, "-f", "{{.Host}}"],
        options,
      );

      return classifyMinikube(status.stdout, status.code);
    }
    case "deployment": {
      if (!existsSync(probe.kubeconfig)) {
        return {
          text: "not set up",
          tone: "dim",
        };
      }
      const deployment = await capture(
        "kubectl",
        [
          "--kubeconfig",
          probe.kubeconfig,
          "-n",
          "floor-agents",
          "get",
          "deploy",
          "agent-controller",
          "-o",
          "jsonpath={.status.readyReplicas}/{.spec.replicas}",
        ],
        options,
      );

      return classifyDeployment(deployment.stdout);
    }
  }
}

const HTTP_POLL_MS = 2_000;
const COMMAND_POLL_MS = 5_000;

export interface PollOptions {
  specs: ServiceSpec[];
  startedAt: Map<string, number>;
  isExited: (name: string) => boolean;
  onStatus: (name: string, status: RowStatus) => void;
}

export interface StatusPoller {
  stop: () => void;
  reported: (name: string, text: string) => void;
}

// Reports a row only when its status text changed; reported records a status the caller already showed.
export function pollStatuses(options: PollOptions): StatusPoller {
  const lastText = new Map<string, string>();
  const pollerStartedAt = Date.now();
  const probed = options.specs.filter((spec) => spec.probe.kind !== "none");
  const timers = probed.map((spec) => {
    const tick = async (): Promise<void> => {
      if (options.isExited(spec.name)) {
        return;
      }
      const startedAt = options.startedAt.get(spec.name) ?? pollerStartedAt;
      const status = await probeOnce(spec.probe, Date.now() - startedAt);

      if (!status || options.isExited(spec.name)) {
        return;
      }

      if (lastText.get(spec.name) === status.text) {
        return;
      }
      lastText.set(spec.name, status.text);
      options.onStatus(spec.name, status);
    };

    void tick();
    const intervalMs =
      spec.probe.kind === "http" ? HTTP_POLL_MS : COMMAND_POLL_MS;

    return setInterval(() => void tick(), intervalMs);
  });

  return {
    stop: () => timers.forEach(clearInterval),
    reported: (name, text) => lastText.set(name, text),
  };
}
