// The plan as the file its planning pod edits (ADR-047): rendered from the live document when the pod asks, and turned back into agent ops when the edited file returns — a draft's written straight in, and a Refine is proposed for the section it asked about and for every other section the settled answers forced.

import {
  markdownToOps,
  planToMarkdown,
  refineUsesSchema,
  templateFor,
  type AgentOp,
  type MarkdownProblem,
} from "@re-cinq/planning-document";
import type { OpsRequest, PassRequest } from "@re-cinq/planning-sync";
import type { LivePlan } from "../../outbound/plans/live-plan.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";

export interface PlanFilePorts {
  /** The plan as it stands in its live document, which people may be editing right now. */
  livePlan(planId: string): Promise<LivePlan>;
  /** The agent's writes into the live document; what they return is not this module's to read. */
  writer: {
    applyOps(request: OpsRequest): Promise<unknown>;
    /** One pass's proposals: the asked section, and each other section the settled answers forced. */
    proposePass(request: PassRequest): Promise<{ skipped: string[] }>;
  };
}

export interface PlanFileSubmission {
  actor: string;
  markdown: string;
  /** The Refine this pass answers, as its run recorded it; null for a draft. */
  refine: { slot: string; baseHash: string; uses?: unknown } | null;
}

/** A section the pass changed whose proposal someone is already reviewing, so this pass left it alone. */
export interface PendingProposalProblem {
  code: "proposal-pending";
  slot: string;
  message: string;
}

export type PlanFileProblem = MarkdownProblem | PendingProposalProblem;

export interface PlanFileOutcome {
  written: number;
  problems: PlanFileProblem[];
}

export async function planMarkdown(
  planId: string,
  ports: PlanFilePorts,
): Promise<string> {
  const { meta, blocks } = await ports.livePlan(planId);

  return planToMarkdown(blocks, templateFor(meta.type));
}

/** Writes what the edited file changed. A file with problems and nothing writable is refused whole, so a broken pass reads as a failure rather than as a silent no-op. */
export async function applyPlanFile(
  planId: string,
  submission: PlanFileSubmission,
  ports: PlanFilePorts,
): Promise<PlanFileOutcome> {
  const read = await readFile(planId, submission.markdown, ports);
  const ops = [...read.ops];

  enforceTrue(
    ops.length > 0 || read.problems.length === 0,
    apiError(400, { problems: read.problems }),
    "plan.md holds nothing that could be written",
  );
  const pending = await write(
    { planId, actor: submission.actor, ops },
    submission.refine,
    ports.writer,
  );

  return { written: ops.length, problems: [...read.problems, ...pending] };
}

async function readFile(
  planId: string,
  markdown: string,
  ports: PlanFilePorts,
): Promise<ReturnType<typeof markdownToOps>> {
  const { meta, blocks } = await ports.livePlan(planId);

  return markdownToOps(markdown, blocks, templateFor(meta.type));
}

/** What one pass writes, before it is known whether it lands as edits or as a proposal. */
interface FileWrite {
  planId: string;
  actor: string;
  ops: AgentOp[];
}

type Refine = NonNullable<PlanFileSubmission["refine"]>;

// A Refine always gets its answer, even an empty one, so the section never waits on an ask nobody will answer.
async function write(
  fileWrite: FileWrite,
  refine: Refine | null,
  writer: PlanFilePorts["writer"],
): Promise<PendingProposalProblem[]> {
  if (refine) {
    return pendingProblems(await propose(fileWrite, refine, writer));
  }

  if (fileWrite.ops.length > 0) {
    await writer.applyOps(fileWrite);
  }

  return [];
}

async function propose(
  { planId, actor, ops }: FileWrite,
  { slot, baseHash, uses }: Refine,
  writer: PlanFilePorts["writer"],
): Promise<string[]> {
  const { skipped } = await writer.proposePass({
    planId,
    actor,
    asked: { slot, baseHash },
    uses: refineUsesSchema.parse(uses ?? {}),
    ops,
  });

  return skipped;
}

function pendingProblems(skipped: string[]): PendingProposalProblem[] {
  return skipped.map((slot) => ({
    code: "proposal-pending" as const,
    slot,
    message: `${slot} already has a proposal waiting, so this pass left it alone`,
  }));
}
