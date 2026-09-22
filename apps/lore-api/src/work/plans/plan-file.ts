// The plan as the file its planning pod edits (ADR-047): rendered from the live document when the pod asks, and turned back into agent ops when the edited file returns — a draft's written straight in, a Refine's proposed for its one section.

import {
  markdownToOps,
  planToMarkdown,
  refineUsesSchema,
  slotOf,
  templateFor,
  type AgentOp,
  type MarkdownProblem,
} from "@re-cinq/planning-document";
import type { OpsRequest, ProposalRequest } from "@re-cinq/planning-sync";
import type { LivePlan } from "../../outbound/plans/live-plan.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";

export interface PlanFilePorts {
  /** The plan as it stands in its live document, which people may be editing right now. */
  livePlan(planId: string): Promise<LivePlan>;
  /** The agent's writes into the live document; what they return is not this module's to read. */
  writer: {
    applyOps(request: OpsRequest): Promise<unknown>;
    propose(request: ProposalRequest): Promise<unknown>;
  };
}

export interface PlanFileSubmission {
  actor: string;
  markdown: string;
  /** The Refine this pass answers, as its run recorded it; null for a draft. */
  refine: { slot: string; baseHash: string; uses?: unknown } | null;
}

/** An edit the file made that a Refine of another section may not carry. */
export interface OutsideRefineProblem {
  code: "outside-refine";
  slot: string;
  message: string;
}

export type PlanFileProblem = MarkdownProblem | OutsideRefineProblem;

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
  const { ops, strays } = scopedToRefine(read.ops, submission.refine);
  const problems = [...read.problems, ...strays];

  enforceTrue(
    ops.length > 0 || problems.length === 0,
    apiError(400, { problems }),
    "plan.md holds nothing that could be written",
  );
  await write(
    { planId, actor: submission.actor, ops },
    submission.refine,
    ports.writer,
  );

  return { written: ops.length, problems };
}

async function readFile(
  planId: string,
  markdown: string,
  ports: PlanFilePorts,
): Promise<ReturnType<typeof markdownToOps>> {
  const { meta, blocks } = await ports.livePlan(planId);

  return markdownToOps(markdown, blocks, templateFor(meta.type));
}

// A Refine answers for one section; what the agent changed elsewhere is reported, never proposed.
function scopedToRefine(
  ops: readonly AgentOp[],
  refine: PlanFileSubmission["refine"],
): { ops: AgentOp[]; strays: OutsideRefineProblem[] } {
  if (!refine) {
    return { ops: [...ops], strays: [] };
  }

  return {
    ops: ops.filter((op) => slotOf(op) === refine.slot),
    strays: ops
      .filter((op) => slotOf(op) !== refine.slot)
      .map((op) => ({
        code: "outside-refine" as const,
        slot: slotOf(op),
        message: `a Refine of ${refine.slot} may not change ${slotOf(op)}`,
      })),
  };
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
): Promise<void> {
  if (refine) {
    await propose(fileWrite, refine, writer);

    return;
  }

  if (fileWrite.ops.length > 0) {
    await writer.applyOps(fileWrite);
  }
}

async function propose(
  { planId, actor, ops }: FileWrite,
  { slot, baseHash, uses }: Refine,
  writer: PlanFilePorts["writer"],
): Promise<void> {
  await writer.propose({
    planId,
    actor,
    slot,
    baseHash,
    uses: refineUsesSchema.parse(uses ?? {}),
    ops,
  });
}
