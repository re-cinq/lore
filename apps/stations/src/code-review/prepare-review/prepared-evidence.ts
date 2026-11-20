import type { Report } from "@re-cinq/floor-station";
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

/** The three packets the collector printed, or the outcome it asks for instead: the report that sends it to the whole-diff reviewer with the reason on the visit, where the run page shows it, or the one that ends it for a commit that is no longer the pull request's head. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): z.infer<typeof packets> | Report {
  const collected = JSON.parse(stdout);
  const refusal = unprepared.safeParse(collected).data;

  if (refusal) {
    return reportOf(refusal);
  }
  const evidence = packets.parse(collected);

  if (previousFindings) {
    evidence.code_evidence.previous_gaps = previousFindings;
    evidence.issue_evidence.previous_gaps = previousFindings;
  }

  return evidence;
}

function reportOf({ status, reason }: z.infer<typeof unprepared>): Report {
  return reason
    ? { outcome: status, produced: { whole_diff_reason: reason } }
    : { outcome: status };
}
