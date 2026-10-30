import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFloor } from "./floor.ts";
import { resolveMode } from "./mode.ts";
import { portsOf, servicesFor, topologyLine } from "./services.ts";

const ROOT = "/work/lore";
const REMOTE_URL = "https://lore-api.gcp.re-cinq.com";

describe("servicesFor", () => {
  it("returns nine processes on the four service ports in local mode without a floor", () => {
    const services = servicesFor({
      mode: resolveMode({}),
      root: ROOT,
      env: {},
      floor: null,
      floorNote: "",
    });
    const processes = services.filter((service) => service.command);

    assert.deepEqual(
      processes.map((service) => service.name),
      [
        "ui",
        "api",
        "skills",
        "stations",
        "shared-tsc",
        "core-tsc",
        "api-tsc",
        "mcp-tsc",
        "stations-tsc",
      ],
    );
    assert.deepEqual(portsOf(services), [3000, 3001, 3002, 3004]);
  });

  it("gives each local server exactly its own environment", () => {
    const services = servicesFor({
      mode: resolveMode({}),
      root: ROOT,
      env: {},
      floor: null,
      floorNote: "",
    });
    const envByName = Object.fromEntries(
      services.map((service) => [service.name, service.env]),
    );

    assert.deepEqual(
      {
        ui: envByName.ui,
        api: envByName.api,
        skills: envByName.skills,
        stations: envByName.stations,
      },
      {
        ui: {},
        api: { PORT: "3001" },
        skills: {
          LORE_MCP_HTTP: "1",
          LORE_MCP_PORT: "3002",
          LORE_AGENT_SKILLS_DIR: "/work/lore/apps/mcp-server/agent-skills",
        },
        stations: { PORT: "3004" },
      },
    );
  });

  it("shows a dimmed floor row when no floor is present", () => {
    const services = servicesFor({
      mode: resolveMode({}),
      root: ROOT,
      env: {},
      floor: null,
      floorNote: "",
    });

    assert.deepEqual(
      services.filter((service) => service.name === "floor"),
      [
        {
          name: "floor",
          role: "not found: clone re-cinq/floor beside lore or set FLOOR_DIR (LORE_DEV_FLOOR=0 turns it off)",
          where: "-",
          kind: "note",
          color: "white",
          env: {},
          probe: { kind: "none" },
        },
      ],
    );
  });

  it("returns exactly the ui with the remote api url in remote mode", () => {
    const services = servicesFor({
      mode: resolveMode({ LORE_API_URL: REMOTE_URL }),
      root: ROOT,
      env: { LORE_API_URL: REMOTE_URL },
      floor: null,
      floorNote: "",
    });

    assert.deepEqual(
      services.map((service) => [service.name, service.env]),
      [["ui", { LORE_API_URL: REMOTE_URL }]],
    );
  });

  it("forwards LORE_WS_URL to the remote ui when present", () => {
    const services = servicesFor({
      mode: resolveMode({ LORE_API_URL: REMOTE_URL }),
      root: ROOT,
      env: { LORE_WS_URL: "wss://lore-api.gcp.re-cinq.com/api/ws" },
      floor: null,
      floorNote: "",
    });

    assert.deepEqual(services[0].env, {
      LORE_API_URL: REMOTE_URL,
      LORE_WS_URL: "wss://lore-api.gcp.re-cinq.com/api/ws",
    });
  });
});

describe("servicesFor with a floor", () => {
  let sandbox: string;
  let loreRoot: string;

  beforeEach(() => {
    sandbox = mkdtempSync(path.join(os.tmpdir(), "lore-dev-services-"));
    loreRoot = path.join(sandbox, "lore");
    mkdirSync(loreRoot);
    mkdirSync(path.join(sandbox, "floor"));
    writeFileSync(
      path.join(sandbox, "floor", "package.json"),
      JSON.stringify({ name: "floor" }),
    );
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("adds the floor process and its three status rows", () => {
    const floor = resolveFloor({}, loreRoot);
    const services = servicesFor({
      mode: resolveMode({}),
      root: loreRoot,
      env: {},
      floor,
      floorNote: "",
    });
    const floorRow = services.find((service) => service.name === "floor");

    assert.deepEqual(
      {
        cwd: floorRow?.cwd,
        env: floorRow?.env,
        statusRows: services
          .filter((service) => service.kind === "status")
          .map((service) => service.name),
      },
      {
        cwd: path.join(sandbox, "floor"),
        env: { PORT: "8180" },
        statusRows: ["postgres", "floor-postgres", "minikube", "ai-subsystem"],
      },
    );
  });

  it("hands the pipeline variables to api and stations", () => {
    const floor = resolveFloor({}, loreRoot);
    const services = servicesFor({
      mode: resolveMode({}),
      root: loreRoot,
      env: {},
      floor,
      floorNote: "",
    });
    const apiEnv = services.find((service) => service.name === "api")?.env;

    assert.deepEqual(apiEnv, { PORT: "3001", ...floor?.pipelineEnv });
  });

  it("frees the floor port and the one after it", () => {
    const services = servicesFor({
      mode: resolveMode({}),
      root: loreRoot,
      env: {},
      floor: resolveFloor({}, loreRoot),
      floorNote: "",
    });

    assert.deepEqual(portsOf(services), [3000, 3001, 3002, 3004, 8180, 8181]);
  });
});

describe("topologyLine", () => {
  it("names host and docker layers without a floor", () => {
    const services = servicesFor({
      mode: resolveMode({}),
      root: ROOT,
      env: {},
      floor: null,
      floorNote: "",
    });

    assert.equal(
      topologyLine(services),
      "host: ui api skills stations · docker: postgres dgraph",
    );
  });
});
