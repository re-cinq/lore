import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { RelayExecutor } from "./relay-executor.js";
import { RELAY_SCRIPT } from "./relay-script.js";

describe("RelayExecutor round-trip against the real sh relay", () => {
  let proc: ChildProcess | undefined;
  let root: string | undefined;

  afterEach(async () => {
    proc?.kill("SIGKILL");
    proc = undefined;

    if (root) {
      await rm(root, { recursive: true, force: true });
    }
    root = undefined;
  });

  async function startRelay(): Promise<RelayExecutor> {
    root = await mkdtemp(join(tmpdir(), "lore-relay-"));
    const relayDir = join(root, "relay");
    const workdir = join(root, "work");

    await mkdir(workdir, { recursive: true });
    const scriptPath = join(root, "relay.sh");

    await writeFile(scriptPath, RELAY_SCRIPT);
    proc = spawn("sh", [scriptPath], {
      env: {
        ...process.env,
        LORE_RELAY_DIR: relayDir,
        LORE_RELAY_WORKDIR: workdir,
      },
      stdio: "ignore",
    });

    return new RelayExecutor(relayDir);
  }

  it("runs a command and returns its stdout with exit 0", async () => {
    const exec = await startRelay();

    expect(await exec.run("echo hello-relay")).toEqual({
      exitCode: 0,
      stdout: "hello-relay\n",
      stderr: "",
    });
  });

  it("captures a non-zero exit code and stderr", async () => {
    const exec = await startRelay();
    const r = await exec.run("echo boom >&2; exit 3");

    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
  });

  it("runs sequential commands in order on the same relay", async () => {
    const exec = await startRelay();
    const a = await exec.run("echo one");
    const b = await exec.run("echo two");

    expect([a.stdout.trim(), b.stdout.trim()]).toEqual(["one", "two"]);
  });

  it("executes commands in the configured workdir", async () => {
    const exec = await startRelay();
    const r = await exec.run("pwd");

    expect(r.stdout.trim().endsWith("/work")).toBe(true);
  });
});
