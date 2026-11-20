import { z } from "zod";

const packet = z.object({ mode: z.string() }).passthrough();
const packets = z.object({
  code_evidence: packet,
  test_evidence: packet,
  intent_evidence: packet,
  challenge_evidence: packet,
  product_evidence: packet,
});

const unprepared = z.enum(["whole_diff", "superseded"]);

/** The five packets the collector printed, or the outcome it asks for instead: the whole-diff reviewer, or nothing for a commit that is no longer the pull request's head. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): z.infer<typeof packets> | z.infer<typeof unprepared> {
  const collected = JSON.parse(stdout);
  const outcome = unprepared.safeParse(collected.status).data;

  if (outcome) {
    return outcome;
  }
  const evidence = packets.parse(collected);

  if (previousFindings) {
    evidence.product_evidence.previous_findings = previousFindings;
  }

  return evidence;
}
