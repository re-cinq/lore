/**
 * Claude Code headless execution mode.
 *
 * Runs the `claude` CLI in non-interactive (--print) mode for complex
 * tasks that need file access, bash, and tool use — things the API-only
 * mode can't do.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
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
  const model = params.model || "claude-sonnet-4-6";

  // 15 min timeout — implementation tasks need time for multi-file edits
  const timeoutMs = 15 * 60_000;

  const args = [
    "--print",
    "--dangerously-skip-permissions",
    "--verbose",
    "--output-format", "stream-json",
    "--model", model,
    "--", params.prompt,
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

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Claude Code timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on("close", async (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const exitCode = code ?? 1;

      if (stderr) {
        console.error(`[agent] Claude Code stderr: ${stderr.substring(0, 500)}`);
      }

      // Estimate tokens from output length (rough: ~4 chars per token)
      const estimatedOutputTokens = Math.ceil(stdout.length / 4);
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
        `output=${stdout.length} chars ${durationMs}ms\n` +
        `[agent] Claude Code stdout (first 2000): ${stdout.substring(0, 2000)}`,
      );

      if (exitCode !== 0 && !stdout) {
        reject(new Error(`Claude Code failed (exit ${exitCode}): ${stderr.substring(0, 500)}`));
        return;
      }

      resolve({ output: stdout, exitCode, durationMs });
    });
  });
}
