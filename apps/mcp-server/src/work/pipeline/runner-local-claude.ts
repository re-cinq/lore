// Launching headless Claude Code: the CLI flags every local run uses and the detached spawn that writes its transcript.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { errFileFor } from "./runner-local-turns.js";

/** Headless streaming JSON, permissions skipped — the worktree is disposable and the run is unattended. */
export function claudeArgs(
  model: string | undefined,
  prompt: string,
): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--model",
    model || "claude-sonnet-4-6",
    "--",
    prompt,
  ];
}

export interface ClaudeRun {
  cwd: string;
  logFile: string;
  /** "w" starts a fresh transcript, "a" appends a retry onto the task's existing one. */
  logMode: "w" | "a";
  model: string | undefined;
  prompt: string;
}

/** Headless Claude Code, detached in the worktree. stdout gets the stream-json transcript (the turn-ingest source, #1295); stderr goes to a sibling file so it can never corrupt an NDJSON line mid-write. */
export function spawnClaude(run: ClaudeRun): number | undefined {
  const logFd = fs.openSync(run.logFile, run.logMode);
  const errFd = fs.openSync(errFileFor(run.logFile), run.logMode);
  const child = spawn("claude", claudeArgs(run.model, run.prompt), {
    cwd: run.cwd,
    detached: true,
    stdio: ["ignore", logFd, errFd],
    env: { ...process.env, HOME: os.homedir() },
  });

  child.unref();
  fs.closeSync(logFd);
  fs.closeSync(errFd);

  return child.pid;
}
