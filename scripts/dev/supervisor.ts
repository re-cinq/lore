import { type ChildProcess, spawn } from "node:child_process";
import type { ServiceSpec } from "./services.ts";

export interface SupervisorHandlers {
  onStart: (service: string) => void;
  onLine: (service: string, text: string) => void;
  onExit: (service: string, code: number | null) => void;
}

interface RunningService {
  child: ChildProcess;
  intentionalStop: boolean;
  closed: Promise<void>;
}

const TERM_GRACE_MS = 2_000;
const GROUP_POLL_MS = 100;
const WATCH_RESTART_DELAY_MS = 1_000;

export function splitChunk(
  pending: string,
  chunk: string,
): { lines: string[]; pending: string } {
  const parts = (pending + chunk).split(/\r?\n/);

  return { lines: parts.slice(0, -1), pending: parts[parts.length - 1] };
}

function groupAlive(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);

    return true;
  } catch {
    return false;
  }
}

function signalGroup(groupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-groupId, signal);
  } catch {
    // the group is already gone
  }
}

// A shell wrapper exits before the node --watch grandchildren do, so the whole process group is what has to disappear.
async function terminateGroup(groupId: number): Promise<void> {
  signalGroup(groupId, "SIGTERM");
  const deadline = Date.now() + TERM_GRACE_MS;

  while (groupAlive(groupId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
  }
  signalGroup(groupId, "SIGKILL");
}

export class Supervisor {
  private readonly running = new Map<string, RunningService>();
  private readonly watchRestarts = new Set<string>();

  constructor(
    private readonly specs: ServiceSpec[],
    private readonly baseEnv: Record<string, string>,
    private readonly root: string,
    private readonly handlers: SupervisorHandlers,
  ) {}

  startAll(): void {
    this.specs
      .filter((spec) => spec.command)
      .forEach((spec) => this.start(spec));
  }

  async restart(name: string): Promise<void> {
    const spec = this.specs.find((candidate) => candidate.name === name);

    if (!spec?.command) {
      return;
    }
    await this.stop(name);
    this.start(spec);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((name) => this.stop(name)));
  }

  private async stop(name: string): Promise<void> {
    const service = this.running.get(name);

    if (!service) {
      return;
    }
    service.intentionalStop = true;

    if (service.child.pid !== undefined) {
      await terminateGroup(service.child.pid);
    }
    await service.closed;
    this.running.delete(name);
  }

  private start(spec: ServiceSpec): void {
    const child = spawn(spec.command ?? "", {
      shell: true,
      cwd: spec.cwd ?? this.root,
      env: { ...this.baseEnv, ...spec.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const service: RunningService = {
      child,
      intentionalStop: false,
      closed: new Promise((resolve) => child.once("close", () => resolve())),
    };

    this.running.set(spec.name, service);
    this.handlers.onStart(spec.name);
    this.pipeLines(spec.name, child);
    child.once("close", (code) => this.handleClose(spec, service, code));
  }

  private pipeLines(name: string, child: ChildProcess): void {
    for (const stream of [child.stdout, child.stderr]) {
      let pending = "";

      stream?.on("data", (chunk: Buffer) => {
        const split = splitChunk(pending, chunk.toString());

        pending = split.pending;
        split.lines.forEach((text) => this.handlers.onLine(name, text));
      });
      stream?.on("end", () => {
        if (pending !== "") {
          this.handlers.onLine(name, pending);
        }
      });
    }
  }

  private handleClose(
    spec: ServiceSpec,
    service: RunningService,
    code: number | null,
  ): void {
    if (service.intentionalStop) {
      return;
    }
    this.running.delete(spec.name);
    this.handlers.onExit(spec.name, code);
    const restartable =
      spec.kind === "watch" && !this.watchRestarts.has(spec.name);

    if (!restartable) {
      return;
    }
    this.watchRestarts.add(spec.name);
    setTimeout(() => this.start(spec), WATCH_RESTART_DELAY_MS);
  }
}
