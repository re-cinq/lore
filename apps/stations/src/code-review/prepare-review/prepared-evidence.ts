import { z } from "zod";

const packet = z.object({ mode: z.string() }).passthrough();
const packets = z.object({
  test_evidence: packet,
  code_evidence: packet,
  issue_evidence: packet,
});

const unprepared = z.object({
  status: z.enum(["whole_diff", "superseded"]),
  reason: z.string().optional(),
});

export interface Unprepared {
  outcome: "whole_diff" | "superseded";
  /** Why the collector could not split the change, shown on the run. */
  reason?: string;
}

/** The three packets the collector printed, or the outcome it asks for instead: the whole-diff reviewer with the reason, or nothing for a commit that is no longer the pull request's head. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): z.infer<typeof packets> | Unprepared {
  const collected = JSON.parse(stdout);
  const refusal = unprepared.safeParse(collected).data;

  if (refusal) {
    return {
      outcome: refusal.status,
      ...(refusal.reason ? { reason: refusal.reason } : {}),
    };
  }
  const evidence = packets.parse(collected);

  if (previousFindings) {
    evidence.code_evidence.previous_gaps = previousFindings;
    evidence.issue_evidence.previous_gaps = previousFindings;
  }

  return evidence;
}
