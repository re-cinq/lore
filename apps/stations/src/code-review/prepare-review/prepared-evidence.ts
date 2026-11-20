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

/** The three packets the collector printed, or the outcome it asks for instead: the report that sends it to the whole-diff reviewer with the reason, or the one that ends it for a commit that is no longer the pull request's head. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): z.infer<typeof packets> | Report {
  const collected = JSON.parse(stdout);
  const refusal = unprepared.safeParse(collected).data;

  // The reason rides on the visit, so the run page says why a pull request got the whole-diff reviewer.
  if (refusal) {
    return {
      outcome: refusal.status,
      ...(refusal.reason
        ? { produced: { whole_diff_reason: refusal.reason } }
        : {}),
    };
  }
  const evidence = packets.parse(collected);

  if (previousFindings) {
    evidence.code_evidence.previous_gaps = previousFindings;
    evidence.issue_evidence.previous_gaps = previousFindings;
  }

  return evidence;
}
