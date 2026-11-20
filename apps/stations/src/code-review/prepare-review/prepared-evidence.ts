import type { Report } from "@re-cinq/floor-station";
import { z } from "zod";

const packet = z.object({ mode: z.string() }).passthrough();
const docs = packet.extend({
  statements: z.array(z.unknown()),
  removed: z.array(z.unknown()),
});
const packets = z.object({
  test_evidence: packet,
  code_evidence: packet,
  issue_evidence: packet,
  docs_evidence: docs,
});

const unprepared = z.object({
  status: z.enum(["whole_diff", "superseded", "links_only"]),
  reason: z.string().optional(),
});
const documentsAlone = z.object({
  status: z.literal("docs_only"),
  docs_evidence: docs,
});

/** What prepare hands on: the packets to store, and the report that routes the run. */
export interface Prepared {
  report: Report;
  packets: Record<string, z.infer<typeof packet>>;
}

/** What the collector printed, as the visit reports it: the four packets of a change with code or tests; the documents packet alone for a change of documents only; no packet and the outcome the collector asks for otherwise, which sends the run to the whole-diff reviewer with the reason on the visit, approves a change of links only, or ends the run of a commit that is no longer the pull request's head. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): Prepared {
  const collected = JSON.parse(stdout);
  const refusal = unprepared.safeParse(collected).data;

  if (refusal) {
    return { report: reportOf(refusal), packets: {} };
  }
  const alone = documentsAlone.safeParse(collected).data;
  const evidence = alone
    ? { docs_evidence: alone.docs_evidence }
    : packets.parse(collected);

  return {
    report: {
      outcome: alone ? "docs_only" : "success",
      produced: {
        review_mode: alone ? "docs" : "story",
        docs_changed: String(hasChanges(evidence.docs_evidence)),
      },
    },
    packets: withPreviousGaps(evidence, previousFindings),
  };
}

function hasChanges({ statements, removed }: z.infer<typeof docs>): boolean {
  return statements.length + removed.length > 0;
}

/** A re-check's checks are handed the gaps still open; the story is told from the tests alone. */
function withPreviousGaps(
  evidence: Prepared["packets"],
  previousFindings?: string,
): Prepared["packets"] {
  return Object.fromEntries(
    Object.entries(evidence).map(([name, held]) => [
      name,
      previousFindings && name !== "test_evidence"
        ? { ...held, previous_gaps: previousFindings }
        : held,
    ]),
  );
}

function reportOf({ status, reason }: z.infer<typeof unprepared>): Report {
  if (status === "links_only") {
    return { outcome: status, produced: { review_mode: "links" } };
  }

  return reason && status === "whole_diff"
    ? { outcome: status, produced: { whole_diff_reason: reason } }
    : { outcome: status };
}
