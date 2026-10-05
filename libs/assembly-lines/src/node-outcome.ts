// The review verdict an agent prints: review stations ask for exactly one REVIEW_RESULT line.

export function parseReviewVerdict(
  output?: string,
): "success" | "changes_requested" | null {
  if (!output) {
    return null;
  }

  if (/REVIEW_RESULT:\s*CHANGES_REQUESTED/i.test(output)) {
    return "changes_requested";
  }

  if (/REVIEW_RESULT:\s*APPROVED/i.test(output)) {
    return "success";
  }

  return null;
}
