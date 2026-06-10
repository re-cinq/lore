/**
 * CliProvider — shells out to the `claude` CLI (`claude -p … --output-format
 * text`), using the developer's subscription instead of API credits. Restores
 * the old facts.ts / graph-extraction CLI fallback behind the shared interface,
 * so EVERY model call (not just those two) can run on subscription with zero API
 * spend — the budget-0 escape hatch. The exec boundary is injectable for tests.
 */

import type {
  LlmCompleteRequest,
  LlmCompletion,
  LlmProvider,
  LlmToolRequest,
  LlmToolResult,
} from "./llm-provider.js";

const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  durationMs: 0,
  model: "claude-cli",
};

/** Minimal exec seam: file + args → { stdout }. Defaults to a promisified execFile. */
export type ExecFn = (file: string, args: string[], opts?: { timeout?: number }) => Promise<{ stdout: string }>;

async function defaultExec(file: string, args: string[], opts?: { timeout?: number }): Promise<{ stdout: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run(file, args, { timeout: opts?.timeout ?? 30_000, env: { ...process.env } });
  return { stdout: String(stdout) };
}

export interface CliProviderOptions {
  execFn?: ExecFn;
}

export class CliProvider implements LlmProvider {
  readonly vendor = "cli";

  constructor(private readonly opts: CliProviderOptions = {}) {}

  async complete(req: LlmCompleteRequest): Promise<LlmCompletion> {
    const text = await this.run(this.combine(req.systemPrompt, req.prompt));
    return { text, ...ZERO_USAGE };
  }

  async completeWithTool<T>(req: LlmToolRequest): Promise<LlmToolResult<T>> {
    const instruction = `${req.toolDescription}\nRespond with ONLY a JSON object matching this schema: ${JSON.stringify(req.toolSchema)}`;
    const prompt = this.combine(req.systemPrompt ? `${req.systemPrompt}\n${instruction}` : instruction, req.prompt);
    return { data: JSON.parse(await this.run(prompt)) as T, ...ZERO_USAGE };
  }

  private combine(systemPrompt: string | undefined, prompt: string): string {
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  }

  private async run(prompt: string): Promise<string> {
    const exec = this.opts.execFn ?? defaultExec;
    const { stdout } = await exec("claude", ["-p", prompt, "--output-format", "text"], { timeout: 30_000 });
    return stdout.trim();
  }
}
