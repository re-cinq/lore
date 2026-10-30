import { existsSync } from "node:fs";
import path from "node:path";
import React from "react";
import { render } from "ink";
import { Dashboard, type DashboardController } from "./Dashboard.tsx";
import { loadEnvFile } from "./env-file.ts";
import { resolveFloor } from "./floor.ts";
import { defaultsFor, resolveMode } from "./mode.ts";
import { formatStepEvent, formatTable, prefixLine } from "./plain.ts";
import { startRuntime } from "./runtime.ts";
import { portsOf, servicesFor, topologyLine } from "./services.ts";
import { prepStepsFor, runSteps } from "./steps.ts";
import type { DashboardAction } from "./reducer.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENV_FILE = path.join(ROOT, ".env.local");

function definedEntries(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
}

function wantsDashboard(): boolean {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  return interactive && !process.env.CI && !process.env.LORE_DEV_PLAIN;
}

function print(lines: string[]): void {
  lines.forEach((line) => console.log(line));
}

function headerLinesFor(options: {
  mode: ReturnType<typeof resolveMode>;
  fileEnv: Record<string, string>;
  services: ReturnType<typeof servicesFor>;
}): string[] {
  const { mode, fileEnv, services } = options;
  const envLine = existsSync(ENV_FILE)
    ? `.env.local loaded (${Object.keys(fileEnv).length} keys)`
    : "no .env.local: run `npm run dev-setup`";
  const configuredApiUrl = fileEnv.LORE_API_URL || process.env.LORE_API_URL;
  const localModeLine = configuredApiUrl
    ? `mode: local  (LORE_API_URL=${configuredApiUrl} → ${mode.apiUrl})`
    : `mode: local  (LORE_API_URL unset → ${mode.apiUrl})`;
  const modeLine =
    mode.kind === "remote"
      ? `mode: remote → ${mode.apiUrl} (web-ui only)`
      : localModeLine;
  const topology =
    mode.kind === "local" ? [`[lore] ${topologyLine(services)}`] : [];

  return [`[lore] ${envLine}`, `[lore] ${modeLine}`, ...topology];
}

async function main(): Promise<number> {
  const fileEnv = loadEnvFile(ENV_FILE);
  const mode = resolveMode({ ...process.env, ...fileEnv });
  const baseEnv = {
    ...definedEntries(process.env),
    ...defaultsFor(mode),
    ...fileEnv,
  };

  const floorSetup = mode.kind === "local" ? resolveFloor(baseEnv, ROOT) : null;
  const floorReady =
    floorSetup && existsSync(path.join(floorSetup.dir, "node_modules"));
  const floorNote =
    floorSetup && !floorReady
      ? `skipped: run \`npm install\` in ${floorSetup.dir}`
      : "";
  const services = servicesFor({
    mode,
    root: ROOT,
    env: baseEnv,
    floor: floorReady ? floorSetup : null,
    floorNote,
  });
  const headerLines = headerLinesFor({ mode, fileEnv, services });

  print(headerLines);

  const useDashboard = wantsDashboard();
  const stepsPassed = await runSteps(
    prepStepsFor({ mode, root: ROOT, env: baseEnv, ports: portsOf(services) }),
    (event) => print(formatStepEvent(event, useDashboard)),
  );

  if (!stepsPassed) {
    return 1;
  }

  return useDashboard
    ? runDashboard(services, baseEnv, headerLines)
    : runPlain(services, baseEnv);
}

async function runDashboard(
  services: ReturnType<typeof servicesFor>,
  baseEnv: Record<string, string>,
  headerLines: string[],
): Promise<number> {
  let runtime: ReturnType<typeof startRuntime> | undefined;
  const controller: DashboardController = {
    attach: (dispatch: (action: DashboardAction) => void) => {
      runtime = startRuntime({
        specs: services,
        baseEnv,
        root: ROOT,
        events: {
          onStatus: (name, status) =>
            dispatch({ type: "status", name, status }),
          onLine: (service, text) => dispatch({ type: "line", service, text }),
          onExit: (service, code) => dispatch({ type: "exit", service, code }),
        },
      });
    },
    restart: (name) => void runtime?.restart(name),
    quit: async () => runtime?.stop(),
  };
  const app = render(
    <Dashboard
      specs={services}
      headerLines={headerLines}
      controller={controller}
    />,
  );

  process.once(
    "SIGTERM",
    () => void controller.quit().then(() => app.unmount()),
  );
  await app.waitUntilExit();
  await controller.quit();

  return 0;
}

async function runPlain(
  services: ReturnType<typeof servicesFor>,
  baseEnv: Record<string, string>,
): Promise<number> {
  const processServices = services.filter((service) => service.command);

  print(formatTable(services));
  print([
    `[lore] starting ${processServices.length} processes; Ctrl-C stops everything`,
  ]);
  const runtime = startRuntime({
    specs: services,
    baseEnv,
    root: ROOT,
    events: {
      onStatus: (name, status) => console.log(`[lore] ${name}: ${status.text}`),
      onLine: (service, text) => console.log(prefixLine(service, text)),
      onExit: (service, code) =>
        console.log(`[lore] ${service} exited (code ${code})`),
    },
  });

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  console.log("[lore] stopping all components...");
  await runtime.stop();

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[lore] ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
