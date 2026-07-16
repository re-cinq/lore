// What the Floor owes a node that has gone terminal, in the one order that
// survives a redelivery. Shared by the node-event handler (the normal path) and
// the reaper (the dropped-event path) — the reaper used to finish nodes without
// posting anything, so a review that arrived through the slower door was lost
// exactly as if it had never run.
//
// Order matters: `finishNodeAndAdvance` can finish the line, and both callers
// early-return on a non-running row, so anything posted after it can never be
// repaired by a retry. Post first, then transition, then publish the check (which
// reads the post-transition terminal state).

import {
  resultTextFromOutput,
  parseReviewVerdict,
  type AgentNodeStatus,
  type AssemblyLineNode,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { AssemblyLineRecord } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import { finishNodeAndAdvance, type AdvanceDeps } from "./advance.js";
import { maybePostReview, type ReviewPoster } from "../review/post-review.js";
import { publishPrCheck } from "./pr-check.js";
import { projectFor } from "../../composition/project-boot.js";
import { writeAuditLog } from "../lib/audit.js";
import type { AuditPort } from "@re-cinq/lore-shared/project/audit/audit-port.js";

/**
 * Unwrap the Agent output envelope so every text parser downstream reads the
 * agent text rather than the NDJSON that carries it. Idempotent for already-plain
 * output, so it is safe at any read boundary.
 */
export function normalizeAgentStatus(status: AgentNodeStatus): AgentNodeStatus {
  if (status.output === undefined) {
    return status;
  }

  return { ...status, output: resultTextFromOutput(status.output) };
}

export interface NodeTerminalInput {
  row: AssemblyLineRecord;
  node: AssemblyLineNode;
  nodeId: string;
  iteration?: number;
  result: NodeResult;
  /** The node's agent text, already normalized by {@link normalizeAgentStatus}. */
  output?: string;
}

/** Ports the review post writes through; production resolves both from the repo. */
export interface ReviewPorts {
  poster?: ReviewPoster;
  audit?: AuditPort;
}

/** Post the review, record the outcome + advance, then publish the PR check. */
export async function finishNodeTerminal(
  input: NodeTerminalInput,
  deps: AdvanceDeps,
): Promise<void> {
  await postReviewFromNode(input.row, input.node, input.output);

  await finishNodeAndAdvance(
    {
      assemblyLineId: input.row.id,
      nodeId: input.nodeId,
      iteration: input.iteration,
      result: input.result,
    },
    deps,
  );

  await publishCheck(input.row.id, deps);
}

/**
 * A review node emits structured findings instead of posting them itself; render
 * and post them here. A review that computes findings and posts nothing is the
 * failure this module exists to make impossible to miss, so both the throw and
 * the silent no-parse are audited rather than warned away.
 */
export async function postReviewFromNode(
  row: AssemblyLineRecord,
  node: AssemblyLineNode,
  output?: string,
  ports: ReviewPorts = {},
): Promise<void> {
  if (node.prompt_ref !== "code-review") {
    return;
  }
  const prNumber = Number(row.args.pr_number) || 0;

  if (!prNumber) {
    return;
  }

  try {
    const pulls = ports.poster ?? (await projectFor(row.repo)).pulls;
    const posted = await maybePostReview(pulls, prNumber, output ?? "");

    if (!posted) {
      await auditUnparsedFindings(row, prNumber, output, ports);
    }
  } catch (err) {
    const message = (err as Error).message;

    console.error("[code-review] post review failed:", message);
    await writeAuditLog(
      {
        event_type: "review_post_failed",
        repo: row.repo,
        payload: {
          pr_number: prNumber,
          assembly_line_id: row.id,
          error: message,
        },
      },
      ports.audit,
    );
  }
}

/** The exact state that produced the outage: a verdict was reached, no findings
 *  parsed, and nothing at all was logged. */
async function auditUnparsedFindings(
  row: AssemblyLineRecord,
  prNumber: number,
  output: string | undefined,
  ports: ReviewPorts,
): Promise<void> {
  const verdict = parseReviewVerdict(output);

  console.error(
    `[code-review] no REVIEW_FINDINGS parsed for PR #${prNumber} (verdict: ${verdict ?? "none"}) — nothing posted`,
  );
  await writeAuditLog(
    {
      event_type: "review_findings_unparsed",
      repo: row.repo,
      payload: {
        pr_number: prNumber,
        assembly_line_id: row.id,
        verdict,
        output_length: output?.length ?? 0,
      },
    },
    ports.audit,
  );
}

/** Publish the line's current state as a PR check (in_progress while running,
 *  terminal once finished). Best-effort — a missing `checks: write` never blocks. */
export async function publishCheck(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const row = await deps.assemblyLines.getById(assemblyLineId);

  if (!row || !(Number(row.args.pr_number) > 0)) {
    return;
  }
  const project = await projectFor(row.repo);

  await publishPrCheck(project.repo, row, process.env.LORE_UI_URL);
}
