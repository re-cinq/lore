// The plan as the file its planning pod edits (ADR-047): rendered from the live document when the pod asks, and turned back into agent ops when the edited file returns — a draft's written straight in, and a Refine is proposed one paragraph at a time, each read and taken under the paragraph it is about.

import {
  markdownToOps,
  planToMarkdown,
  refineUsesSchema,
  templateFor,
  type AgentOp,
  type MarkdownProblem,
} from "@re-cinq/planning-document";
import type {
  FailRequest,
  OpsRequest,
  PassRequest,
} from "@re-cinq/planning-sync";
import type { LivePlan } from "../../outbound/plans/live-plan.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";

export interface PlanFilePorts {
  /** The plan as it stands in its live document, which people may be editing right now. */
  livePlan(planId: string): Promise<LivePlan>;
  /** The agent's writes into the live document; what they return is not this module's to read. */
  writer: {
    applyOps(request: OpsRequest): Promise<unknown>;
    /** One pass's proposals, one per paragraph it changed: each is read and taken where it lands. */
    proposeChanges(request: PassRequest): Promise<unknown>;
    /** A Refine whose pass stopped before it answered: the section says why, and can be asked again. */
    failRefine(request: FailRequest): Promise<unknown>;
  };
}

export interface PlanFileSubmission {
  actor: string;
  markdown: string;
  /** The Refine this pass answers, as its run recorded it; null for a draft. */
  refine: { slot: string; baseHash: string; uses?: unknown } | null;
}

export type PlanFileProblem = MarkdownProblem;

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
  await write(
    { planId, actor: submission.actor, ops },
    submission.refine,
    ports.writer,
  );

  return { written: ops.length, problems: read.problems };
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
  await writer.proposeChanges({
    planId,
    actor,
    asked: { slot, baseHash },
    uses: refineUsesSchema.parse(uses ?? {}),
    ops,
  });
}
