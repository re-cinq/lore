import type { RowStatus } from "./health.ts";
import { pollStatuses } from "./probe.ts";
import type { ServiceSpec } from "./services.ts";
import { Supervisor } from "./supervisor.ts";

export interface RuntimeEvents {
  onStatus: (name: string, status: RowStatus) => void;
  onLine: (service: string, text: string) => void;
  onExit: (service: string, code: number | null) => void;
}

export interface Runtime {
  restart: (name: string) => Promise<void>;
  stop: () => Promise<void>;
}

export interface RuntimeOptions {
  specs: ServiceSpec[];
  baseEnv: Record<string, string>;
  root: string;
  events: RuntimeEvents;
}

export function startRuntime(options: RuntimeOptions): Runtime {
  const { specs, events } = options;
  const startedAt = new Map<string, number>();
  const exited = new Set<string>();

  const poller = pollStatuses({
    specs,
    startedAt,
    isExited: (name) => exited.has(name),
    onStatus: events.onStatus,
  });

  const supervisor = new Supervisor(specs, options.baseEnv, options.root, {
    onStart: (name) => {
      startedAt.set(name, Date.now());
      exited.delete(name);
      const isWatch =
        specs.find((spec) => spec.name === name)?.kind === "watch";
      const status: RowStatus = isWatch
        ? { text: "running", tone: "ok" }
        : { text: "starting", tone: "wait" };

      poller.reported(name, status.text);
      events.onStatus(name, status);
    },
    onLine: events.onLine,
    onExit: (name, code) => {
      exited.add(name);
      events.onExit(name, code);
    },
  });

  supervisor.startAll();

  let stopping: Promise<void> | undefined;

  return {
    restart: (name) => supervisor.restart(name),
    stop: () => {
      stopping ??= supervisor.stopAll().then(poller.stop);

      return stopping;
    },
  };
}
