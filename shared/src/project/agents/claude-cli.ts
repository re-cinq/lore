import { spawn } from "node:child_process";

/**
 * The `claude --print` spawn core, relocated from agent/src/claude-code.ts
 * (runClaudeCode). The binary is configurable via LORE_AGENT_CLI so callers can
 * point at a wrapper or a stub; defaults to `claude` on PATH.
 */

export interface ClaudeCliResult {
  exitCode: number;
  output: string;
}

export function runClaudeCli(params: {
  prompt: string;
  workDir?: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<ClaudeCliResult> {
  const env = params.env ?? process.env;
  const bin = env.LORE_AGENT_CLI ?? "claude";
  const workDir = params.workDir ?? "/tmp";
  const model = params.model ?? "claude-sonnet-4-6";
  const timeoutMs = params.timeoutMs ?? 15 * 60_000;

  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--",
    params.prompt,
  ];

  return new Promise<ClaudeCliResult>((resolve, reject) => {
    let stdout = "";
    const proc = spawn(bin, args, { cwd: workDir, env: { ...env }, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`agent CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: stdout });
    });
  });
}
