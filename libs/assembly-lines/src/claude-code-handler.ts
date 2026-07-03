import type {
  NodeContext,
  NodeHandler,
  NodeResult,
} from "./assembly-line-executor.js";
import type { AssemblyLineNode } from "./loader.js";
import { runClaudeCode, type ClaudeCodeResult } from "./claude-code.js";

/**
 * Factory for an agent handler that drives Claude Code (tool-use)
 * rather than calling the Anthropic SDK directly. Used inside the
 * Job pod where `claude` CLI is on PATH and the workdir is the
 * cloned target repo.
 *
 * The handler:
 *  - resolves the prompt via `deps.resolvePrompt(promptRef, taskMeta)`
 *  - spawns `claude --print …` in `ctx.gitDir`
 *  - returns `{ outcome: 'success' }` once Claude Code exits 0;
 *    the executor's stage commit then captures whatever files
 *    Claude Code edited via its Bash/Write tools.
 *
 * Failure modes mapped to outcomes:
 *  - non-zero claude exit → `failed` with `Lore-Validation-Status: cli-nonzero`
 *  - thrown error from runClaudeCode (timeout / spawn fail / missing CLI)
 *    → `failed` with `Lore-Validation-Status: cli-error`
 *  - missing prompt_ref / unresolvable prompt → `failed` with `config-error`
 */
export interface ClaudeCodeHandlerDeps {
  /** Override for testing — defaults to the production runClaudeCode. */
  runClaudeCode?: (params: {
    prompt: string;
    workDir?: string;
    model?: string;
    taskId?: string;
  }) => Promise<ClaudeCodeResult>;
  /**
   * Resolves a node's prompt_ref to a concrete prompt string. Same
   * shape as the JSON-handler resolver minus systemPrompt — Claude
   * Code carries its own system prompt via its tool affordances.
   */
  resolvePrompt: (
    promptRef: string,
    taskDescription: string,
  ) => string | null;
}

export interface ClaudeCodeHandlerTaskMeta {
  taskId: string;
  description: string;
  taskType: string;
}

export function createClaudeCodeAgentHandler(
  deps: ClaudeCodeHandlerDeps,
  meta: ClaudeCodeHandlerTaskMeta,
): NodeHandler {
  const runner = deps.runClaudeCode ?? runClaudeCode;

  return async (
    node: AssemblyLineNode,
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

    const prompt = deps.resolvePrompt(node.prompt_ref, meta.description);
    if (!prompt) {
      return {
        outcome: "failed",
        extras: {
          "Lore-Validation-Status": "config-error",
          "Lore-Validation-Summary": `prompt_ref "${node.prompt_ref}" not found`,
        },
      };
    }

    let result: ClaudeCodeResult;
    try {
      result = await runner({
        prompt,
        workDir: ctx.gitDir,
        model: node.model,
        taskId: meta.taskId,
      });
    } catch (err) {
      return {
        outcome: "failed",
        extras: {
          "Lore-Validation-Status": "cli-error",
          "Lore-Validation-Summary": (err as Error).message.substring(0, 300),
        },
      };
    }

    if (result.exitCode !== 0) {
      return {
        outcome: "failed",
        extras: {
          "Lore-Validation-Status": "cli-nonzero",
          "Lore-Validation-Summary":
            `claude exited ${result.exitCode}: ${result.output.slice(-300)}`,
        },
      };
    }

    // Token counts aren't surfaced by ClaudeCodeResult today (the
    // stream-json output carries them but parsing is the runClaudeCode
    // module's job). For now we only record duration; cost accounting
    // for in-pod Claude Code happens via pipeline.llm_calls writes
    // inside runClaudeCode itself.
    return {
      outcome: "success",
      extras: {
        "Lore-CLI-Duration-Ms": String(result.durationMs),
      },
    };
  };
}
