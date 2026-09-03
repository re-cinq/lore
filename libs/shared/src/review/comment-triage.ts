/** Haiku classification for comment triage (what action Lore should take). */

import { Llm } from "../llm/llm.js";
import type { LlmUsage } from "../llm/llm-provider.js";

export type TriageAction = "review" | "address" | "answer" | "ignore";

export interface CommentContext {
  /** The human comment body. */
  body: string;
  /** True when this is a reply on a specific review-comment thread. */
  isReply: boolean;
  prNumber: number;
  /** The review comment being replied to (thread root), when this is a reply. */
  originalComment?: string;
}

export interface TriageDecision {
  action: TriageAction;
  reason: string;
  /** Usage of the classification call; absent when triage failed. */
  usage?: LlmUsage;
}

const ACTIONS: TriageAction[] = ["review", "address", "answer", "ignore"];
const TRIAGE_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You triage a single human comment on a pull request and decide what Lore should do. Choose exactly one action:
- "review": the human asks Lore to (re)review the PR.
- "address": the human approves or requests a code change (e.g. "ok, fix it", "please change this"). Lore should edit code and commit.
- "answer": the human asks a question or wants a discussion reply, with no code change.
- "ignore": chatter, thanks, acknowledgements, or anything needing no Lore action.
Prefer "ignore" when unsure.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    reason: { type: "string" },
  },
  required: ["action", "reason"],
} as const;

/** Classify PR comment into follow-up action; model failures propagate (not swallowed). */
export async function classifyComment(
  ctx: CommentContext,
): Promise<TriageDecision> {
  const { parsed, ...usage } = await Llm.instance.completeWithTool<{
    action?: string;
    reason?: string;
  }>({
    prompt: buildPrompt(ctx),
    systemPrompt: SYSTEM_PROMPT,
    model: TRIAGE_MODEL,
    jobName: "comment-triage",
    toolName: "triage_comment",
    toolDescription: "Classify the PR comment into a single Lore action.",
    toolSchema: TOOL_SCHEMA,
  });

  return {
    action: isAction(parsed?.action) ? parsed.action : "ignore",
    reason: parsed?.reason ?? "",
    usage,
  };
}

function buildPrompt(ctx: CommentContext): string {
  const lines = [`PR #${ctx.prNumber}.`];

  if (ctx.isReply && ctx.originalComment) {
    lines.push(`Replying to this review comment:\n${ctx.originalComment}`);
  }
  lines.push(`Human comment:\n${ctx.body}`);

  return lines.join("\n\n");
}

function isAction(value: unknown): value is TriageAction {
  return typeof value === "string" && (ACTIONS as string[]).includes(value);
}
