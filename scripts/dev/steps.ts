import { existsSync } from "node:fs";
import path from "node:path";
import { capture } from "./exec.ts";
import { freePorts, isLsofInstalled } from "./ports.ts";
import type { Mode } from "./mode.ts";

export interface StepResult {
  note?: string;
  warnings?: string[];
}

export interface Step {
  title: string;
  fix: string;
  run: () => Promise<StepResult | void>;
}

export interface StepContext {
  mode: Mode;
  root: string;
  env: Record<string, string>;
  ports: number[];
}

export type StepEvent =
  | { type: "running"; title: string }
  | { type: "done"; title: string; seconds: number; note?: string }
  | { type: "warning"; text: string }
  | {
      type: "failed";
      title: string;
      code: number | null;
      seconds: number;
      tail: string[];
      fix: string;
    };

export class StepFailure extends Error {
  readonly code: number | null;
  readonly outputLines: string[];

  constructor(code: number | null, outputLines: string[]) {
    super(`step failed with exit code ${code}`);
    this.code = code;
    this.outputLines = outputLines;
  }
}

const TAIL_LINES = 20;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

function commandStep(
  title: string,
  fix: string,
  command: string,
  args: string[],
  context: StepContext,
): Step {
  return {
    title,
    fix,
    run: async () => {
      const result = await capture(command, args, {
        cwd: context.root,
        env: context.env,
      });

      if (result.code === 0) {
        return;
      }
      const missingProgram = [`${command}: command not found`];

      throw new StepFailure(
        result.code,
        result.code === null ? missingProgram : result.outputLines,
      );
    },
  };
}

function dockerStep(context: StepContext): Step {
  return {
    title: "docker + compose v2 found",
    fix: "Install docker with the compose v2 plugin: https://docs.docker.com/engine/install/ and https://docs.docker.com/compose/install/",
    run: async () => {
      const docker = await capture("docker", ["--version"]);

      if (docker.code !== 0) {
        throw new StepFailure(docker.code, ["docker not found or not working"]);
      }
      const compose = await capture("docker", ["compose", "version"], {
        env: context.env,
      });

      if (compose.code !== 0) {
        throw new StepFailure(compose.code, ["docker compose v2 not found"]);
      }
    },
  };
}

function webUiDependenciesStep(context: StepContext): Step {
  const installed = existsSync(
    path.join(context.root, "apps", "web-ui", "node_modules"),
  );
  const install = commandStep(
    "web-ui dependencies installed",
    "Run `npm --prefix apps/web-ui install` and read the error.",
    "npm",
    ["--prefix", "apps/web-ui", "install"],
    context,
  );

  return installed ? { ...install, run: async () => undefined } : install;
}

function portsStep(context: StepContext): Step {
  const label = context.ports.join(" ");

  return {
    title: `ports ${label} free`,
    fix: "Find what holds the port with `ss -lptn 'sport = :<port>'` and stop it.",
    run: async () => {
      if (!(await isLsofInstalled())) {
        return {
          warnings: ["lsof not found: stale instances were not stopped"],
        };
      }
      const freed = await freePorts(context.ports);

      return {
        warnings: freed.map(
          ({ port, pids }) =>
            `port ${port} was held by a stale instance (PID ${pids.join(" ")}); stopped it`,
        ),
      };
    },
  };
}

function warningsStep(context: StepContext): Step {
  const warnings: string[] = [];
  const localMode = context.mode.kind === "local";
  const oauthMissing =
    !context.env.GITHUB_OAUTH_CLIENT_ID ||
    !context.env.GITHUB_OAUTH_CLIENT_SECRET;

  if (localMode && oauthMissing) {
    warnings.push(
      "GitHub OAuth is not configured, so web-ui login will fail. Create an OAuth app at https://github.com/settings/developers (homepage http://localhost:3000, callback http://localhost:3001/api/auth/callback), put GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET in .env.local, then restart.",
    );
  }

  if (existsSync(path.join(context.root, "apps", "web-ui", ".env.local"))) {
    warnings.push(
      "apps/web-ui/.env.local is ignored by `npm start`; delete it. The one env file is the root .env.local.",
    );
  }

  return {
    title: "environment checked",
    fix: "",
    run: async () => ({ warnings }),
  };
}

function remoteHealthStep(context: StepContext): Step {
  return {
    title: `probed ${context.mode.apiUrl}/healthz`,
    fix: "",
    run: async () => {
      const healthUrl = `${context.mode.apiUrl}/healthz`;

      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
        });

        if (response.ok) {
          return;
        }

        return {
          warnings: [
            `${healthUrl} answered ${response.status}; sign-in may fail`,
          ],
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        return {
          warnings: [
            `${healthUrl} did not answer (${reason}); sign-in may fail`,
          ],
        };
      }
    },
  };
}

function localSteps(context: StepContext): Step[] {
  const dgraphSteps = context.env.LORE_DGRAPH_HTTP
    ? [
        commandStep(
          "Dgraph schema",
          "Run `npm run dgraph:schema` with DGRAPH_HTTP set to your LORE_DGRAPH_HTTP to see the full output.",
          "bash",
          [
            "-c",
            'DGRAPH_HTTP="$LORE_DGRAPH_HTTP" bash scripts/infra/setup-memory-dgraph-schema.sh && DGRAPH_HTTP="$LORE_DGRAPH_HTTP" bash scripts/infra/setup-spec-trace-schema.sh',
          ],
          context,
        ),
      ]
    : [];

  return [
    dockerStep(context),
    commandStep(
      "Postgres + Dgraph containers healthy (docker compose)",
      'Run `docker compose -f infra/compose.yaml logs` to see why a container is unhealthy. A root-owned .lore-pgdata from an older image: see docs/building-lore/contributing.md, section "Starting over from scratch".',
      "docker",
      ["compose", "-f", "infra/compose.yaml", "up", "-d", "--wait"],
      context,
    ),
    commandStep(
      "Postgres schema + migrations",
      'Run `npm run db:schema` to see the full output. A root-owned .lore-pgdata from an older image: see docs/building-lore/contributing.md, section "Starting over from scratch".',
      "bash",
      ["scripts/infra/setup-local-schema.sh"],
      context,
    ),
    ...dgraphSteps,
    webUiDependenciesStep(context),
    commandStep(
      "workspace build (shared, assembly-lines, stations, server-core, lore-api, mcp-server)",
      "Run the failing workspace build alone (`npm run build -w <workspace>`). In a git worktree run `scripts/worktree-bootstrap.sh` first.",
      "npm",
      ["run", "build"],
      context,
    ),
    portsStep(context),
    warningsStep(context),
  ];
}

function remoteSteps(context: StepContext): Step[] {
  return [
    webUiDependenciesStep(context),
    portsStep(context),
    remoteHealthStep(context),
    warningsStep(context),
  ];
}

export function prepStepsFor(context: StepContext): Step[] {
  return context.mode.kind === "remote"
    ? remoteSteps(context)
    : localSteps(context);
}

function failureOf(error: unknown): StepFailure {
  if (error instanceof StepFailure) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);

  return new StepFailure(null, [reason]);
}

export async function runSteps(
  steps: Step[],
  report: (event: StepEvent) => void,
): Promise<boolean> {
  for (const step of steps) {
    report({ type: "running", title: step.title });
    const startedAt = Date.now();

    try {
      const result = await step.run();
      const seconds = (Date.now() - startedAt) / 1000;
      const warnings = result?.warnings ?? [];

      report({ type: "done", title: step.title, seconds, note: result?.note });
      warnings.forEach((text) => report({ type: "warning", text }));
    } catch (error) {
      const failure = failureOf(error);

      report({
        type: "failed",
        title: step.title,
        code: failure.code,
        seconds: (Date.now() - startedAt) / 1000,
        tail: failure.outputLines.slice(-TAIL_LINES),
        fix: step.fix,
      });

      return false;
    }
  }

  return true;
}
