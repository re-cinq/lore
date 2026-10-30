import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readControllerRelease, resolveFloor } from "./floor.ts";

let sandbox: string;
let loreRoot: string;
let floorDir: string;

function writeFloorManifest(name: string): void {
  mkdirSync(floorDir, { recursive: true });
  writeFileSync(path.join(floorDir, "package.json"), JSON.stringify({ name }));
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), "lore-dev-floor-"));
  loreRoot = path.join(sandbox, "lore");
  floorDir = path.join(sandbox, "floor");
  mkdirSync(loreRoot);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveFloor", () => {
  it("returns null when no floor directory exists", () => {
    assert.equal(resolveFloor({}, loreRoot), null);
  });

  it("returns null when the sibling directory is not the floor", () => {
    writeFloorManifest("something-else");
    assert.equal(resolveFloor({}, loreRoot), null);
  });

  it("returns the defaults for a floor beside lore", () => {
    writeFloorManifest("floor");
    assert.deepEqual(resolveFloor({}, loreRoot), {
      dir: floorDir,
      port: 8180,
      pipelineEnv: {
        FLOOR_PORT: "8180",
        FLOOR_API_URL: "http://localhost:8180",
        FLOOR_SERVICE_TOKEN: "floor-dev-token",
        LORE_AGENT_IMAGE: "ghcr.io/re-cinq/lore-agent:latest",
        LORE_SKILLS_URL: "http://host.minikube.internal:3002/skills",
        LORE_MCP_URL: "http://host.minikube.internal:3002/mcp",
      },
      forwardedEnv: {},
    });
  });

  it("moves the api url when FLOOR_PORT is 9000", () => {
    writeFloorManifest("floor");
    assert.deepEqual(
      resolveFloor({ FLOOR_PORT: "9000" }, loreRoot)?.pipelineEnv,
      {
        FLOOR_PORT: "9000",
        FLOOR_API_URL: "http://localhost:9000",
        FLOOR_SERVICE_TOKEN: "floor-dev-token",
        LORE_AGENT_IMAGE: "ghcr.io/re-cinq/lore-agent:latest",
        LORE_SKILLS_URL: "http://host.minikube.internal:3002/skills",
        LORE_MCP_URL: "http://host.minikube.internal:3002/mcp",
      },
    );
  });

  it("returns null when LORE_DEV_FLOOR is 0", () => {
    writeFloorManifest("floor");
    assert.equal(resolveFloor({ LORE_DEV_FLOOR: "0" }, loreRoot), null);
  });

  it("keeps a FLOOR_SERVICE_TOKEN set in .env.local", () => {
    writeFloorManifest("floor");
    assert.equal(
      resolveFloor({ FLOOR_SERVICE_TOKEN: "mine" }, loreRoot)?.pipelineEnv
        .FLOOR_SERVICE_TOKEN,
      "mine",
    );
  });

  it("finds the floor at FLOOR_DIR relative to the lore root", () => {
    floorDir = path.join(sandbox, "elsewhere");
    writeFloorManifest("floor");
    assert.equal(
      resolveFloor({ FLOOR_DIR: "../elsewhere" }, loreRoot)?.dir,
      floorDir,
    );
  });

  it("forwards FLOOR_AGENTS and FLOOR_SETUP when set", () => {
    writeFloorManifest("floor");
    assert.deepEqual(
      resolveFloor({ FLOOR_AGENTS: "0", FLOOR_SETUP: "1" }, loreRoot)
        ?.forwardedEnv,
      { FLOOR_AGENTS: "0", FLOOR_SETUP: "1" },
    );
  });
});

describe("readControllerRelease", () => {
  it("reads the release named above the pinned controller image", () => {
    mkdirSync(path.join(floorDir, "scripts"), { recursive: true });
    writeFileSync(
      path.join(floorDir, "scripts", "setup-minikube-agents.sh"),
      "# The pair the subsystem released as v0.11.11; they move together.\nCONTROLLER_IMAGE=x\n",
    );
    assert.equal(readControllerRelease(floorDir), "v0.11.11");
  });

  it("returns null when the setup script is missing", () => {
    assert.equal(readControllerRelease(floorDir), null);
  });
});
