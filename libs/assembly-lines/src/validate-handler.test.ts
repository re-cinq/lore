import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createValidateHandler } from "./validate-handler.js";
import { RELAY_SCRIPT } from "./relay/relay-script.js";
import type { NodeContext } from "./assembly-line-executor.js";
import type { AssemblyLineNode } from "./loader.js";

const node = { id: "validate", type: "validate" } as unknown as AssemblyLineNode;
const ctx = (gitDir: string): NodeContext => ({
  taskId: "t1",
  branchName: "b",
  gitDir,
  iteration: 0,
  assemblyLineName: "wf",
});

const dirs: string[] = [];
async function tmpRepo(pkg: object | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lore-validate-"));
  dirs.push(dir);
  if (pkg) await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}
const NODE_PKG = (lint: string) => ({ name: "x", version: "1.0.0", scripts: { lint } });

describe("createValidateHandler — local", () => {
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("returns success when no tooling is detected", async () => {
    const dir = await tmpRepo(null);
    expect((await createValidateHandler()(node, ctx(dir))).outcome).toBe("success");
  });

  it("returns success when the repo's check passes", async () => {
    const dir = await tmpRepo(NODE_PKG("true"));
    expect((await createValidateHandler()(node, ctx(dir))).outcome).toBe("success");
  });

  it("returns failed and names the failing step when a check fails", async () => {
    const dir = await tmpRepo(NODE_PKG("false"));
    const r = await createValidateHandler()(node, ctx(dir));
    expect(r.outcome).toBe("failed");
    expect(r.extras?.["Lore-Validation-Failed"]).toContain("lint");
  });
});

describe("createValidateHandler — relay (BYO sidecar)", () => {
  let proc: ChildProcess | undefined;
  afterEach(async () => {
    proc?.kill("SIGKILL");
    proc = undefined;
    for (const d of dirs) await rm(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it("runs the repo's check through the relay and reports success", async () => {
    const dir = await tmpRepo(NODE_PKG("true"));
    const relayDir = join(dir, ".relay");
    const scriptPath = join(dir, "relay.sh");
    await writeFile(scriptPath, RELAY_SCRIPT);
    proc = spawn("sh", [scriptPath], {
      env: { ...process.env, LORE_RELAY_DIR: relayDir, LORE_RELAY_WORKDIR: dir },
      stdio: "ignore",
    });
    expect(
      (await createValidateHandler({ relayDir })(node, ctx(dir))).outcome,
    ).toBe("success");
  });
});
