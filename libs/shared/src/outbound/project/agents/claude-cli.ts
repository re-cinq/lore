import { spawn } from "node:child_process";

// claude --print spawn core; binary configurable via LORE_AGENT_CLI (defaults to claude on PATH).

export interface ClaudeCliResult {
  exitCode: number;
  output: string;
}

/** The CLI invocation. `--` before the prompt matters: a prompt beginning with a dash would otherwise be parsed as a flag. `stream-json` is what the transcript store reads, and `--verbose` is what makes it emit per-turn lines rather than only a final answer. */
function cliArgs(model: string, prompt: string): string[] {
  return [
    "--print",
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--",
    prompt,
  ];
}

/** Collects the run's stdout and settles on exit. A timeout SIGTERMs rather than killing outright, so the CLI can flush the transcript it has produced so far — that output is the only record of what the agent did before it hung. A missing exit code counts as 1: a process that died without one did not succeed. */
function collectOutput(
  proc: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<ClaudeCliResult> {
  return new Promise<ClaudeCliResult>((resolve, reject) => {
    let stdout = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
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

  const args = cliArgs(model, params.prompt);

  const proc = spawn(bin, args, {
    cwd: workDir,
    env: { ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return collectOutput(proc, timeoutMs);
}
