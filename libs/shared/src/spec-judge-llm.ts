/**
 * The LLM half of the spec judge — the model-backed steps that pair the pure
 * scoring/matching in `spec-judge.ts`. Kept in a separate module so `spec-judge.ts`
 * stays free of the LLM provider's transitive deps. Parameterized by a job context
 * so each caller keeps its own `jobName` for cost accounting.
 */

import { Llm } from "./llm/llm.js";
import type { Assertion } from "./spec-judge.js";

export interface LlmJobContext {
  jobName: string;
}

const ASSERTION_CONTENT_LIMIT = 12000;

const EXTRACT_ASSERTIONS_TOOL_SCHEMA = {
  type: "object",
  properties: {
    assertions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "The exact name of the function, class, type, or endpoint",
          },
          kind: {
            type: "string",
            enum: [
              "function",
              "class",
              "interface",
              "type",
              "endpoint",
              "other",
            ],
          },
          description: {
            type: "string",
            description: "What this assertion checks for",
          },
        },
        required: ["name", "kind", "description"],
      },
    },
  },
  required: ["assertions"],
} as const;

/**
 * Extract the concrete symbols (functions/classes/types/endpoints) a spec says
 * should exist — the assertion set spec-drift and spec-coverage-backfill both
 * feed into the pure matcher. Identical prompt/schema across callers; only the
 * `jobName` (for cost accounting) differs.
 */
export async function extractAssertions(
  specContent: string,
  filePath: string,
  ctx: LlmJobContext,
): Promise<Assertion[]> {
  const result = await Llm.instance.completeWithTool<{
    assertions: Assertion[];
  }>({
    prompt: `Analyze this specification and extract testable assertions — concrete names of functions, classes, interfaces, types, or API endpoints that SHOULD exist in the codebase based on this spec.

Only extract items that are explicitly named in the spec. Do not infer or guess.

Spec file: ${filePath}
---
${specContent.substring(0, ASSERTION_CONTENT_LIMIT)}`,
    systemPrompt:
      "You extract testable code assertions from specifications. Return only explicitly named items.",
    toolName: "extract_assertions",
    toolDescription: "Extract testable assertions from a spec",
    toolSchema: EXTRACT_ASSERTIONS_TOOL_SCHEMA as unknown as Record<
      string,
      unknown
    >,
    jobName: ctx.jobName,
  });

  return result.data.assertions || [];
}
