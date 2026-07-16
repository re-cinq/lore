/**
 * The comment-triage core: a cheap Haiku classification that decides what, if
 * anything, Lore should do with a human PR comment. Run by the `comment-triage`
 * station; the Floor routes the returned {@link TriageAction} to the right line
 * (review / address-and-commit / answer-in-thread / nothing). "ignore" is the
 * cost-saver — chatter never spins up an action pod.
 *
 * Model-free path is proven by the LLM seam: a thrown/invalid completion defaults
 * to `ignore` rather than taking an action on a guess.
 */

import { Llm } from "../llm/llm.js";

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

export async function classifyComment(
  ctx: CommentContext,
): Promise<TriageDecision> {
  try {
    const { data } = await Llm.instance.completeWithTool<{
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
      action: isAction(data?.action) ? data.action : "ignore",
      reason: data?.reason ?? "",
    };
  } catch {
    return { action: "ignore", reason: "triage failed" };
  }
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
