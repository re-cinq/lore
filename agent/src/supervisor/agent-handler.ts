import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  NodeContext,
  NodeHandler,
  NodeResult,
} from "./graph-executor.js";
import type { WorkflowNode } from "../workflow/loader.js";
import type { LlmCompletion } from "@re-cinq/lore-shared";

/**
 * Factory dependencies. All injectable so the handler can be unit-tested
 * without hitting Anthropic / a real filesystem.
 */
export interface AgentHandlerDeps {
  /** Wraps `callLLM` from agent/src/anthropic.ts. */
  callLLM: (params: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    taskId?: string;
    jobName?: string;
  }) => Promise<LlmCompletion>;
  /**
   * Resolves a node's `prompt_ref` to a system prompt + user prompt
   * template. Default reads from agent/src/config.ts task-types.yaml.
   */
  resolvePrompt: (
    promptRef: string,
    taskDescription: string,
  ) => { systemPrompt: string; prompt: string } | null;
  /** Override for tests — defaults to fs.writeFile. */
  writeFile?: (path: string, content: string) => Promise<void>;
  /**
   * For tasks whose LLM output is a JSON object of `{ files: { path:
   * content } }`. The handler writes each file under `gitDir`. Set to
   * `false` for tasks that drive edits via Claude Code tools (those
   * need a different handler — see the follow-up wire-up note in
   * handlers.ts).
   */
  parseJsonFiles?: boolean;
}

/**
 * The "what's the task description" data the agent handler needs.
 * Carried separately from NodeContext because the handler is built
 * once per supervisor run and parameterized by the task.
 */
export interface AgentHandlerTaskMeta {
  taskId: string;
  description: string;
  /** task_type from pipeline.tasks. */
  taskType: string;
}

interface JsonFileOutput {
  files?: Record<string, string>;
}

/**
 * Build an agent NodeHandler. Each `agent` node in the workflow:
 *  1. Resolves its `prompt_ref` via `deps.resolvePrompt`.
 *  2. Calls `deps.callLLM`.
 *  3. If `parseJsonFiles` is true: parses the response as a `{ files
 *     }` map and writes each file under `gitDir`.
 *  4. Returns `{ outcome: 'success', extras: { Lore-Cost-Tokens } }`.
 *
 * Handlers for Claude-Code-driven nodes (implementation, general,
 * review) need richer dispatch and are wired separately in a follow-up
 * once the Job pod entrypoint refactor is done.
 */
export function createAgentHandler(
  deps: AgentHandlerDeps,
  meta: AgentHandlerTaskMeta,
): NodeHandler {
  const writer = deps.writeFile ?? fs.writeFile;
  const parseJsonFiles = deps.parseJsonFiles ?? true;

  return async (
    node: WorkflowNode,
    ctx: NodeContext,
  ): Promise<NodeResult> => {
    if (!node.prompt_ref) {
      return {
        outcome: "failed",
        extras: {
          "Lore-Validation-Status": "config-error",
          "Lore-Validation-Summary": `agent node "${node.id}" has no prompt_ref`,
        },
      };
    }

    const resolved = deps.resolvePrompt(node.prompt_ref, meta.description);
    if (!resolved) {
      return {
        outcome: "failed",
        extras: {
          "Lore-Validation-Status": "config-error",
          "Lore-Validation-Summary": `prompt_ref "${node.prompt_ref}" not found in task-types.yaml`,
        },
      };
    }

    let result: LlmCompletion;
    try {
      result = await deps.callLLM({
        prompt: resolved.prompt,
        systemPrompt: resolved.systemPrompt,
        model: node.model,
        taskId: meta.taskId,
        jobName: `dark-factory/${node.id}`,
      });
    } catch (err) {
      return {
        outcome: "failed",
        extras: {
          "Lore-LLM-Error": (err as Error).message.substring(0, 300),
        },
      };
    }

    // Token counts only — no dollar amounts in commit trailers (these
    // are git-permanent and surface anywhere `git log` is read; the
    // user's stated preference is no USD anywhere in the audit trail).
    const costExtra = {
      "Lore-Cost-Tokens": `input=${result.inputTokens} output=${result.outputTokens}`,
    };

    if (!parseJsonFiles) {
      // The LLM output is treated as opaque (push-only nodes, review
      // nodes that post comments via `gh`, etc.). Caller composes a
      // specialized handler for those.
      return { outcome: "success", extras: costExtra };
    }

    const fileMap = extractJsonFiles(result.text);
    if (!fileMap || Object.keys(fileMap).length === 0) {
      return {
        outcome: "failed",
        extras: {
          ...costExtra,
          "Lore-Validation-Status": "parse-error",
          "Lore-Validation-Summary": "LLM output did not contain a parseable {files: …} JSON object",
        },
      };
    }

    // Partial writes are intentional: if the agent crashes mid-write
    // (or the sanitizer rejects some paths), the next stage's
    // `git add -A && git commit --allow-empty` picks up whatever did
    // land. The implementation.yaml `implement → implement (on:
    // failed, iteration_max: 1)` self-edge bounds the retry; lease
    // takeover handles full pod death.
    let writtenCount = 0;
    for (const [relPath, content] of Object.entries(fileMap)) {
      const safe = sanitizeRelativePath(relPath);
      if (!safe) continue;
      const fullPath = path.join(ctx.gitDir, safe);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await writer(fullPath, content);
      writtenCount++;
    }

    return {
      outcome: "success",
      extras: {
        ...costExtra,
        "Lore-Files-Written": String(writtenCount),
      },
    };
  };
}

/**
 * Extract a `{ "files": { ... } }` JSON object from an LLM response.
 * Tolerates code fences and trailing prose. Returns null when no
 * parseable object is found or `files` isn't a dict of strings.
 */
export function extractJsonFiles(
  text: string,
): Record<string, string> | null {
  // Try direct parse first.
  const direct = tryParse(text);
  if (direct) return direct;

  // Fenced code blocks.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const fromFence = tryParse(fenced[1]);
    if (fromFence) return fromFence;
  }

  // Brace-balanced extraction.
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return tryParse(text.slice(start, i + 1));
      }
    }
  }
  return null;
}

function tryParse(s: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(s) as JsonFileOutput;
    if (!parsed.files || typeof parsed.files !== "object") return null;
    for (const value of Object.values(parsed.files)) {
      if (typeof value !== "string") return null;
    }
    return parsed.files;
  } catch {
    return null;
  }
}

/**
 * Reject path-traversal attempts before writing to the worktree. An
 * LLM-produced path like `../../etc/passwd` or absolute paths must
 * never escape the worktree root.
 */
function sanitizeRelativePath(p: string): string | null {
  if (!p) return null;
  if (path.isAbsolute(p)) return null;
  // path.normalize collapses any embedded `..` segments; a remaining
  // leading `..` is the only escape case we need to reject.
  const normalized = path.normalize(p);
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("..\\")) {
    return null;
  }
  return normalized;
}
