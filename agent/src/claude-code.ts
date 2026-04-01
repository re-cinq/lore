/**
 * Claude Code headless execution mode.
 *
 * Runs the `claude` CLI in non-interactive (--print) mode for complex
 * tasks that need file access, bash, and tool use — things the API-only
 * mode can't do.
 */

import { execFile, execFileSync } from "node:child_process";
import { query } from "./db.js";

export interface ClaudeCodeResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

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
}): Promise<ClaudeCodeResult> {
  const workDir = params.workDir || "/tmp";
  const model = params.model || "claude-sonnet-4-20250514";
  const maxTokens = params.maxTokens || 16384;

  // Timeout: default 5 min, scale up for large maxTokens
  const timeoutMs = Math.max(5 * 60_000, Math.ceil(maxTokens / 4096) * 60_000);

  const args = [
    "--print",
    "--model", model,
    params.prompt,
  ];

  const start = Date.now();

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    execFile(
      "claude",
      args,
      {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024, // 50 MB
        env: { ...process.env },
      },
      async (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const exitCode = error?.code
          ? typeof error.code === "number"
            ? error.code
            : 1
          : 0;

        if (stderr) {
          console.error(`[agent] Claude Code stderr: ${stderr.substring(0, 500)}`);
        }

        const output = stdout || "";

        // Estimate tokens from output length (rough: ~4 chars per token)
        const estimatedOutputTokens = Math.ceil(output.length / 4);
        const estimatedInputTokens = Math.ceil(params.prompt.length / 4);

        // Log to pipeline.llm_calls
        try {
          await query(
            `INSERT INTO pipeline.llm_calls
               (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              params.taskId || null,
              "claude-code",
              model,
              estimatedInputTokens,
              estimatedOutputTokens,
              0, // actual cost tracked by Claude Code internally
              durationMs,
            ],
          );
        } catch (logErr: any) {
          console.error(`[agent] Failed to log Claude Code call: ${logErr.message}`);
        }

        console.log(
          `[agent] Claude Code: model=${model} exit=${exitCode} ` +
          `output=${output.length} chars ${durationMs}ms`,
        );

        if (error && !stdout) {
          reject(new Error(`Claude Code failed (exit ${exitCode}): ${error.message}`));
          return;
        }

        resolve({ output, exitCode, durationMs });
      },
    );
  });
}
