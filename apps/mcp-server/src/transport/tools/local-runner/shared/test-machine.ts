import { execSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway developer machine: HOME (holding `.lore/`), a scratch root for working directories, and a `bin/` to put first on PATH. HOME is read once when the runner module loads, so a test file takes one machine for all its tests. */
export interface TestMachine {
  root: string;
  home: string;
  loreDir: string;
  bin: string;
  originalCwd: string;
}

export function createTestMachine(): TestMachine {
  const root = mkdtempSync(join(tmpdir(), "lore-local-runner-"));
  const home = join(root, "home");
  const machine = {
    root,
    home,
    loreDir: join(home, ".lore"),
    bin: join(root, "bin"),
    originalCwd: process.cwd(),
  };

  mkdirSync(machine.loreDir, { recursive: true });
  mkdirSync(machine.bin);

  return machine;
}

export function writeLoreFile(
  machine: TestMachine,
  name: string,
  value: unknown,
): string {
  const file = join(machine.loreDir, name);

  writeFileSync(file, JSON.stringify(value));

  return file;
}

export function readLoreFile(machine: TestMachine, name: string): unknown {
  return JSON.parse(readFileSync(join(machine.loreDir, name), "utf-8"));
}

/** Stands the process in a fresh directory; with a remote it is a git checkout of it with one commit. */
export function enterDirectory(
  machine: TestMachine,
  opts: { remote?: string } = {},
): string {
  const dir = mkdtempSync(join(machine.root, "cwd-"));

  if (opts.remote) {
    initCheckout(dir, opts.remote);
  }
  process.chdir(dir);

  return dir;
}

/** Puts an executable `claude` on the machine's PATH that exits at once, so a spawn succeeds without starting Claude Code. */
export function installFakeClaude(machine: TestMachine): void {
  const claude = join(machine.bin, "claude");

  writeFileSync(claude, "#!/bin/sh\nexit 0\n");
  chmodSync(claude, 0o755);
}

export function resetMachine(machine: TestMachine): void {
  process.chdir(machine.originalCwd);
  rmSync(machine.loreDir, { recursive: true, force: true });
  mkdirSync(machine.loreDir, { recursive: true });
}

function initCheckout(dir: string, remote: string): void {
  const git = (args: string) => execSync(`git ${args}`, { cwd: dir });

  git("init -q -b main");
  git(`remote add origin ${remote}`);
  git(
    "-c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init",
  );
}
