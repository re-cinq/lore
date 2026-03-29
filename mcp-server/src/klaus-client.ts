/**
 * Klaus MCP client.
 *
 * Communicates with Klaus via the Streamable HTTP MCP protocol.
 * Uses @modelcontextprotocol/sdk client for proper session management.
 *
 * Klaus exposes a single /mcp endpoint that requires:
 * 1. Session initialization (initialize request)
 * 2. Tool calls via the session
 *
 * For task submission, we use Klaus's built-in "prompt" tool which
 * starts a Claude Code subprocess with the given prompt.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ── Interfaces ───────────────────────────────────────────────────────

export interface SubmitTaskResponse {
  task_id: string;
  status: "submitted";
  output?: string;
  cost?: number | null;
}

export interface TaskStatus {
  task_id: string;
  status: "submitted" | "running" | "completed" | "failed";
  elapsed?: number;
  failure_reason?: string;
}

export interface TaskResult {
  task_id: string;
  status: "completed";
  output: string;
}

export interface KlausError {
  error: true;
  message: string;
}

type KlausResult<T> = T | KlausError;

// ── Helpers ──────────────────────────────────────────────────────────

function getEndpoint(): string {
  const endpoint = process.env.LORE_KLAUS_ENDPOINT;
  if (!endpoint) {
    throw new Error("LORE_KLAUS_ENDPOINT environment variable is not set");
  }
  return endpoint.replace(/\/+$/, "");
}

export function isKlausError(value: unknown): value is KlausError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).error === true
  );
}

// ── MCP Client ──────────────────────────────────────────────────────

let client: Client | null = null;
let clientReady = false;

async function getClient(): Promise<Client> {
  if (client && clientReady) return client;

  const endpoint = getEndpoint();
  const url = new URL("/mcp", endpoint);

  const transport = new StreamableHTTPClientTransport(url);
  client = new Client(
    { name: "lore-pipeline", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  clientReady = true;
  console.log("[klaus-client] Connected to Klaus MCP at", endpoint);
  return client;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Submit a task to Klaus. Klaus runs it as a Claude Code subprocess.
 *
 * We use the MCP protocol to send a prompt. Klaus's built-in behavior
 * is to run Claude Code with the prompt and return the result.
 */
export async function submitTask(
  task: string,
  contextBundle: string,
  priority: string
): Promise<KlausResult<SubmitTaskResponse>> {
  try {
    const c = await getClient();

    // List available tools to find the right one
    const tools = await c.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    console.log("[klaus-client] Available tools:", toolNames.join(", "));

    // Try different tool names Klaus might expose
    const promptTool =
      toolNames.find((n) => n === "prompt" || n === "run" || n === "execute") ||
      toolNames[0];

    if (!promptTool) {
      return { error: true, message: "Klaus has no tools available" };
    }

    const fullPrompt = contextBundle
      ? `${task}\n\n## Context\n${contextBundle}`
      : task;

    // 1. Start the task via "prompt" tool
    console.log("[klaus-client] Calling prompt tool...");
    const promptResult = await c.callTool({
      name: "prompt",
      arguments: { message: fullPrompt },
    });
    console.log("[klaus-client] Prompt returned:", JSON.stringify(promptResult.content).substring(0, 200));

    // 2. Poll "status" until agent is done
    let attempts = 0;
    let statusText = "";
    const maxAttempts = 120; // 120 * 5s = 10 minutes max
    while (attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000));
      attempts++;

      const statusResult = await c.callTool({
        name: "status",
        arguments: {},
      });
      statusText = Array.isArray(statusResult.content)
        ? statusResult.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
        : "";

      console.log(`[klaus-client] Status poll ${attempts}: ${statusText.substring(0, 100)}`);

      // Check if the agent is done
      if (statusText.includes('"idle"') || statusText.includes('"stopped"') || statusText.includes('"completed"')) {
        break;
      }
    }

    // 3. Get the result
    console.log("[klaus-client] Fetching result...");
    const resultCall = await c.callTool({
      name: "result",
      arguments: {},
    });
    const contentArr = Array.isArray(resultCall.content) ? resultCall.content : [];
    const output = contentArr
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || "";

    console.log(`[klaus-client] Result length: ${output.length} chars`);

    // Extract cost from the last status poll if available
    const costMatch = statusText.match(/"total_cost_usd":([\d.]+)/);
    const cost = costMatch ? parseFloat(costMatch[1]) : null;

    return {
      task_id: `klaus-${Date.now()}`,
      status: "submitted",
      output,
      cost,
    };
  } catch (err: any) {
    // Reset client on connection errors
    client = null;
    clientReady = false;
    return { error: true, message: `Klaus error: ${err.message}` };
  }
}

// ── Async API (non-blocking dispatch + background poll) ─────────────

/**
 * Submit a task to Klaus asynchronously — fires the prompt and returns
 * immediately with a session ID instead of blocking until completion.
 */
export async function submitTaskAsync(
  task: string, contextBundle: string, priority: string
): Promise<KlausResult<{ session_id: string }>> {
  try {
    const c = await getClient();
    const tools = await c.listTools();
    const promptTool = tools.tools.find(t => t.name === 'prompt') || tools.tools[0];
    if (!promptTool) return { error: true, message: 'No tools available' };

    const fullPrompt = contextBundle ? `${task}\n\n## Context\n${contextBundle}` : task;

    // Fire and forget — prompt returns immediately with session info
    const model = process.env.KLAUS_MODEL || process.env.CLAUDE_MODEL || undefined;
    const args: Record<string, string> = { message: fullPrompt };
    if (model) args.model = model;
    const result = await c.callTool({ name: 'prompt', arguments: args });
    const text = Array.isArray(result.content)
      ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      : '';

    // Extract session ID
    const sessionMatch = text.match(/"session_id":"([^"]+)"/);
    return { session_id: sessionMatch?.[1] || `unknown-${Date.now()}` };
  } catch (err: any) {
    client = null; clientReady = false;
    return { error: true, message: `Klaus error: ${err.message}` };
  }
}

/**
 * Poll Klaus status every 5 seconds until the agent is idle/stopped/completed.
 * Then fetch the final result.
 */
export async function pollKlausUntilDone(
  onStatus?: (status: string) => void,
  maxMinutes: number = 10
): Promise<{ output: string; cost: number | null }> {
  const c = await getClient();
  const maxAttempts = maxMinutes * 12; // 5s intervals
  let statusText = '';

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const result = await c.callTool({ name: 'status', arguments: {} });
    statusText = Array.isArray(result.content)
      ? result.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      : '';

    onStatus?.(statusText.substring(0, 100));

    if (statusText.includes('"idle"') || statusText.includes('"stopped"') || statusText.includes('"completed"')) {
      break;
    }
  }

  // Fetch result
  const resultCall = await c.callTool({ name: 'result', arguments: {} });
  const output = Array.isArray(resultCall.content)
    ? resultCall.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    : '';

  const costMatch = statusText.match(/"total_cost_usd":([\d.]+)/);
  return { output, cost: costMatch ? parseFloat(costMatch[1]) : null };
}

/**
 * Get status. Since we're using synchronous tool calls, the task is
 * either completed (we have the result) or failed. No polling needed.
 */
export async function getTaskStatus(
  taskId: string
): Promise<KlausResult<TaskStatus>> {
  // With synchronous MCP calls, the task is already done when submitTask returns
  return {
    task_id: taskId,
    status: "completed",
  };
}

/**
 * Get result. Not applicable with synchronous MCP calls — the result
 * comes back from submitTask directly.
 */
export async function getTaskResult(
  taskId: string
): Promise<KlausResult<TaskResult>> {
  return {
    task_id: taskId,
    status: "completed",
    output: "",
  };
}

/**
 * Check Klaus server status (not via MCP, just the /status HTTP endpoint).
 */
export async function getKlausStatus(): Promise<any> {
  try {
    const endpoint = getEndpoint();
    const res = await fetch(`${endpoint}/status`);
    return await res.json();
  } catch (err: any) {
    return { error: true, message: err.message };
  }
}
