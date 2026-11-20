import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { z } from "zod";

const packet = z.object({ mode: z.string() }).passthrough();
const packets = z.object({
  code_evidence: packet,
  test_evidence: packet,
  intent_evidence: packet,
  challenge_evidence: packet,
  product_evidence: packet,
});

/** The five packets the collector printed; nothing when it asks for the whole-diff reviewer. */
export function preparedEvidence(
  stdout: string,
  previousFindings?: string,
): z.infer<typeof packets> | undefined {
  const collected = JSON.parse(stdout);

  enforceTrue(
    collected.status !== "superseded",
    Error,
    "The pull request changed during evidence preparation",
  );

  if (collected.status === "whole_diff") {
    return undefined;
  }
  const evidence = packets.parse(collected);

  if (previousFindings) {
    evidence.product_evidence.previous_findings = previousFindings;
  }

  return evidence;
}

/** A packet as the file an agent reads: a text of several lines becomes a list of its numbered lines, because a reader opens a file a page of lines at a time and cannot open one long line. */
export function pagedPacket(packet: unknown): string {
  return JSON.stringify(
    packet,
    (_key, value: unknown) =>
      typeof value === "string" && value.includes("\n")
        ? value.split("\n").map((line, index) => `${index + 1}| ${line}`)
        : value,
    1,
  );
}
