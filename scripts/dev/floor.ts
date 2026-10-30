import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface FloorSetup {
  dir: string;
  port: number;
  pipelineEnv: Record<string, string>;
  forwardedEnv: Record<string, string>;
}

type Env = Record<string, string | undefined>;

const DEFAULT_FLOOR_PORT = 8180;
const FORWARDED_FLOOR_VARIABLES = ["FLOOR_AGENTS", "FLOOR_SETUP"];

export function resolveFloor(env: Env, root: string): FloorSetup | null {
  if (env.LORE_DEV_FLOOR === "0") {
    return null;
  }
  const dir = path.resolve(root, env.FLOOR_DIR || "../floor");

  if (!isFloorCheckout(dir)) {
    return null;
  }

  const port = Number(env.FLOOR_PORT || DEFAULT_FLOOR_PORT);
  const pipelineEnv = withUserOverrides(env, {
    FLOOR_PORT: String(port),
    FLOOR_API_URL: `http://localhost:${port}`,
    FLOOR_SERVICE_TOKEN: "floor-dev-token",
    LORE_AGENT_IMAGE: "ghcr.io/re-cinq/lore-agent:latest",
    LORE_SKILLS_URL: "http://host.minikube.internal:3002/skills",
    LORE_MCP_URL: "http://host.minikube.internal:3002/mcp",
  });
  const forwardedEnv = Object.fromEntries(
    FORWARDED_FLOOR_VARIABLES.flatMap((name) =>
      env[name] === undefined ? [] : [[name, env[name]]],
    ),
  );

  return { dir, port, pipelineEnv, forwardedEnv };
}

export function readControllerRelease(floorDir: string): string | null {
  const setupScript = path.join(
    floorDir,
    "scripts",
    "setup-minikube-agents.sh",
  );

  if (!existsSync(setupScript)) {
    return null;
  }
  const release = /released as (v\d+\.\d+\.\d+)/.exec(
    readFileSync(setupScript, "utf8"),
  );

  return release ? release[1] : null;
}

function isFloorCheckout(dir: string): boolean {
  const manifest = path.join(dir, "package.json");

  if (!existsSync(manifest)) {
    return false;
  }
  const parsed: { name?: string } = JSON.parse(readFileSync(manifest, "utf8"));

  return parsed.name === "floor";
}

function withUserOverrides(
  env: Env,
  defaults: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(defaults).map(([name, value]) => [name, env[name] || value]),
  );
}
