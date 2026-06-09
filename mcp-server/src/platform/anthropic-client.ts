/**
 * Anthropic API client — single source of truth for direct Messages-API
 * calls from the MCP server. Falls back to the Claude CLI (subscription,
 * no API credits) when ANTHROPIC_API_KEY is not set.
 */

const GRAPH_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

/**
 * Build the graph-extraction LLM call closure. Uses the Anthropic
 * Messages API when ANTHROPIC_API_KEY is set (tracking cost into
 * pipeline.llm_calls via the provided pool), else shells out to the
 * Claude CLI. Extracted verbatim from index.ts write_episode.
 */
export function createGraphLlmCall(pool: any): (prompt: string) => Promise<string> {
  const graphModel = process.env.LORE_FACT_MODEL || GRAPH_MODEL_DEFAULT;
  return async (prompt: string) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fall back to Claude CLI (uses subscription, no API credits)
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('claude', ['-p', prompt, '--output-format', 'text'], {
        timeout: 30_000,
        env: { ...process.env },
      });
      return stdout.trim();
    }
    const start = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: graphModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const json = await res.json() as any;
    const durationMs = Date.now() - start;
    // Track cost
    if (json.usage && pool) {
      const inputCost = 0.8 / 1_000_000;
      const outputCost = 4.0 / 1_000_000;
      const costUsd = json.usage.input_tokens * inputCost + json.usage.output_tokens * outputCost;
      pool.query(
        `INSERT INTO pipeline.llm_calls (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms)
         VALUES (NULL, 'graph-extraction', $1, $2, $3, $4, $5)`,
        [graphModel, json.usage.input_tokens, json.usage.output_tokens, costUsd, durationMs],
      ).catch(() => {});
    }
    return json.content[0].text;
  };
}
