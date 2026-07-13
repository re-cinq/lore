/**
 * Claude Code headless execution mode.
 *
 * Runs the `claude` CLI in non-interactive (--print) mode for complex
 * tasks that need file access, bash, and tool use — things the API-only
 * mode can't do.
 */

import { execFileSync, spawn } from "node:child_process";

export interface ClaudeCodeResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Optional usage sink — the caller (agent bootstrap) backs this with
 * `project.usage.logLlmCall` so the kernel records the call without
 * importing a pg pool. Absent in tests / API-less runs.
 */
export type LogUsage = (record: {
  taskId?: string | null;
  jobName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}) => Promise<void>;

/**
 * Check if the `claude` CLI is available in PATH.
 */
export function isClaudeCodeAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 5_000 });

    return true;
  } catch {
    return false;
  }
}

/**
 * Run Claude Code CLI in headless mode (non-interactive).
 * Uses the `claude` CLI with --print flag for non-interactive execution.
 * The claude CLI must be available in the container's PATH.
 */
export async function runClaudeCode(params: {
  prompt: string;
  workDir?: string;
  model?: string;
  maxTokens?: number;
  taskId?: string;
  /** Wall-clock budget (ms); falls back to LORE_CLAUDE_TIMEOUT_MS, then 15 min. */
  timeoutMs?: number;
  /** Cap on agentic turns; falls back to LORE_CLAUDE_MAX_TURNS (0/unset = uncapped). */
  maxTurns?: number;
  /** Injected accounting sink; when absent, the call is not logged. */
  logUsage?: LogUsage;
}): Promise<ClaudeCodeResult> {
  const workDir = params.workDir || "/tmp";
  const model = params.model || "claude-sonnet-4-6";

  // Wall-clock budget. Configurable so it can sit below an outer container/Job
  // deadline, leaving headroom for the agent to flush result.json. Default 15 min.
  const timeoutMs =
    params.timeoutMs ??
    (Number(process.env.LORE_CLAUDE_TIMEOUT_MS) || 15 * 60_000);
  // Optional cap on agentic turns — bounds runaway exploration so the agent
  // converges on an answer within budget. Off by default.
  const maxTurns =
    params.maxTurns ?? (Number(process.env.LORE_CLAUDE_MAX_TURNS) || 0);

  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format",
    "stream-json",
    "--model",
    model,
    ...(maxTurns > 0 ? ["--max-turns", String(maxTurns)] : []),
    "--",
    params.prompt,
  ];

  const start = Date.now();

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("claude", args, {
      cwd: workDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Echo claude's stream to our stdout too, so it reaches the container log
    // the Station tails live (the run is slow; surfacing claude's activity gives
    // the wizard something to show beyond the supervisor's node markers).
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude Code timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- async close handler; all failures are caught/logged inside
    proc.on("close", async (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const exitCode = code ?? 1;

      if (stderr) {
        console.error(
          `[agent] Claude Code stderr: ${stderr.substring(0, 500)}`,
        );
      }

      // Estimate tokens from output length (rough: ~4 chars per token)
      const estimatedOutputTokens = Math.ceil(stdout.length / 4);
      const estimatedInputTokens = Math.ceil(params.prompt.length / 4);

      // Account the call through the injected usage sink (project.usage).
      // Non-fatal: a logging failure must not fail the task.
      if (params.logUsage) {
        try {
          await params.logUsage({
            taskId: params.taskId ?? null,
            jobName: "claude-code",
            model,
            inputTokens: estimatedInputTokens,
            outputTokens: estimatedOutputTokens,
            durationMs,
          });
        } catch (logErr) {
          console.error(
            `[agent] Failed to log Claude Code call: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
          );
        }
      }

      console.log(
        `[agent] Claude Code: model=${model} exit=${exitCode} ` +
          `output=${stdout.length} chars ${durationMs}ms\n` +
          `[agent] Claude Code stdout (first 2000): ${stdout.substring(0, 2000)}`,
      );

      if (exitCode !== 0 && !stdout) {
        reject(
          new Error(
            `Claude Code failed (exit ${exitCode}): ${stderr.substring(0, 500)}`,
          ),
        );

        return;
      }

      resolve({ output: stdout, exitCode, durationMs });
    });
  });
}
