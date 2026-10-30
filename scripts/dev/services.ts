import path from "node:path";
import { type FloorSetup, readControllerRelease } from "./floor.ts";
import type { Mode } from "./mode.ts";

export type Probe =
  | { kind: "http"; url: string }
  | { kind: "docker"; container: string }
  | { kind: "minikube"; profile: string }
  | { kind: "deployment"; kubeconfig: string }
  | { kind: "none" };

export interface ServiceSpec {
  name: string;
  role: string;
  where: string;
  kind: "server" | "watch" | "status" | "note";
  color: string;
  env: Record<string, string>;
  probe: Probe;
  command?: string;
  cwd?: string;
  port?: number;
}

export interface ServicesOptions {
  mode: Mode;
  root: string;
  env: Record<string, string | undefined>;
  floor: FloorSetup | null;
  floorNote: string;
}

const UI_PORT = 3000;
const API_PORT = 3001;
const SKILLS_PORT = 3002;
const STATIONS_PORT = 3004;

const FLOOR_ABSENT_NOTE =
  "not found: clone re-cinq/floor beside lore or set FLOOR_DIR (LORE_DEV_FLOOR=0 turns it off)";

function server(
  name: string,
  role: string,
  color: string,
  port: number,
  command: string,
  extra: { env?: Record<string, string>; cwd?: string; healthPath?: string },
): ServiceSpec {
  return {
    name,
    role,
    color,
    port,
    command,
    kind: "server",
    where: `http://localhost:${port}`,
    env: extra.env ?? {},
    cwd: extra.cwd,
    probe: {
      kind: "http",
      url: `http://localhost:${port}${extra.healthPath ?? "/healthz"}`,
    },
  };
}

function watch(name: string, color: string, workspace: string): ServiceSpec {
  return {
    name,
    color,
    role: `tsc --watch ${workspace}`,
    kind: "watch",
    where: "(watch)",
    command: `npm run dev -w ${workspace}`,
    env: {},
    probe: { kind: "none" },
  };
}

function statusRow(
  name: string,
  role: string,
  where: string,
  probe: Probe,
): ServiceSpec {
  return { name, role, where, probe, kind: "status", color: "white", env: {} };
}

function uiService(options: ServicesOptions): ServiceSpec {
  const { mode, env } = options;
  const remoteEnv: Record<string, string> = {
    LORE_API_URL: mode.apiUrl,
    ...(env.LORE_WS_URL ? { LORE_WS_URL: env.LORE_WS_URL } : {}),
  };

  return server("ui", "Next.js web UI", "cyan", UI_PORT, "npm run dev", {
    cwd: path.join(options.root, "apps", "web-ui"),
    healthPath: "/",
    env: mode.kind === "remote" ? remoteEnv : {},
  });
}

function floorRows(options: ServicesOptions): ServiceSpec[] {
  const { floor, floorNote, env } = options;

  if (!floor) {
    return [
      {
        ...statusRow("floor", floorNote || FLOOR_ABSENT_NOTE, "-", {
          kind: "none",
        }),
        kind: "note",
      },
    ];
  }
  const release = readControllerRelease(floor.dir);
  const profile = env.MINIKUBE_PROFILE || "minikube";

  return [
    {
      ...server(
        "floor",
        "floor API + cluster agent (floor's own npm start)",
        "magenta",
        floor.port,
        "npm start",
        {
          cwd: floor.dir,
          env: { PORT: String(floor.port), ...floor.forwardedEnv },
        },
      ),
      where: `host  http://localhost:${floor.port}`,
    },
    statusRow(
      "floor-postgres",
      "the floor's database",
      "docker  localhost:5433",
      { kind: "docker", container: "floor-postgres" },
    ),
    statusRow(
      "minikube",
      "cluster for agent pods",
      `minikube profile "${profile}"`,
      { kind: "minikube", profile },
    ),
    statusRow(
      "ai-subsystem",
      `agent-controller (ai-agent-subsystem ${release ?? "release unknown"})`,
      "minikube  ns floor-agents",
      {
        kind: "deployment",
        kubeconfig: path.join(floor.dir, ".floor-kubeconfig-minikube"),
      },
    ),
  ];
}

function localServices(options: ServicesOptions): ServiceSpec[] {
  const { root, floor, env } = options;
  const floorEnv = floor?.pipelineEnv ?? {};

  return [
    uiService(options),
    server(
      "api",
      "lore-api REST + /api/ws",
      "green",
      API_PORT,
      "npm run start:watch -w @re-cinq/lore-api",
      { env: { PORT: String(API_PORT), ...floorEnv } },
    ),
    server(
      "skills",
      "MCP gateway + /skills registry",
      "yellow",
      SKILLS_PORT,
      "npm run start -w @re-cinq/lore-mcp",
      {
        env: {
          LORE_MCP_HTTP: "1",
          LORE_MCP_PORT: String(SKILLS_PORT),
          LORE_AGENT_SKILLS_DIR: path.join(
            root,
            "apps",
            "mcp-server",
            "agent-skills",
          ),
        },
      },
    ),
    server(
      "stations",
      "stations sweeps + floor stations",
      "redBright",
      STATIONS_PORT,
      "npm run start:watch -w @re-cinq/lore-stations",
      { env: { PORT: String(STATIONS_PORT), ...floorEnv } },
    ),
    statusRow("postgres", "lore / postgres / lore", "localhost:5432 (docker)", {
      kind: "docker",
      container: env.LORE_PG_CONTAINER || "lore-postgres",
    }),
    ...floorRows(options),
    watch("shared-tsc", "blue", "@re-cinq/lore-shared"),
    watch("core-tsc", "gray", "@re-cinq/lore-server-core"),
    watch("api-tsc", "green", "@re-cinq/lore-api"),
    watch("mcp-tsc", "yellow", "@re-cinq/lore-mcp"),
    watch("stations-tsc", "redBright", "@re-cinq/lore-stations"),
  ];
}

export function servicesFor(options: ServicesOptions): ServiceSpec[] {
  return options.mode.kind === "remote"
    ? [uiService(options)]
    : localServices(options);
}

export function portsOf(services: ServiceSpec[]): number[] {
  const floorPort = services.find((service) => service.name === "floor")?.port;
  const processPorts = services.flatMap((service) =>
    service.command && service.port ? [service.port] : [],
  );

  return floorPort ? [...processPorts, floorPort + 1] : processPorts;
}

export function topologyLine(services: ServiceSpec[]): string {
  const hasFloor = services.some(
    (service) => service.name === "floor" && service.command,
  );
  const host = [
    "ui",
    "api",
    "skills",
    "stations",
    ...(hasFloor ? ["floor"] : []),
  ];
  const docker = [
    "postgres",
    "dgraph",
    ...(hasFloor ? ["floor-postgres"] : []),
  ];
  const layers = [`host: ${host.join(" ")}`, `docker: ${docker.join(" ")}`];

  if (hasFloor) {
    layers.push("minikube: ai-agent-subsystem + agent pods");
  }

  return layers.join(" · ");
}
