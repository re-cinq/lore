/** How much of an issue body a ticket description carries. Issue bodies are
 *  unbounded (a generated link report ran ~40KB) and the description is
 *  rendered into every loop pod's prompt, so the tail past the cap is cut and
 *  marked — the pod can still read the rest through the issue URL in its
 *  context bundle. */
const BODY_CAP = 16_000;

/** The ticket text an implementation-loop pod defines done against: the issue
 *  title AND body. Minting `picked.title` alone gave the DoD node a one-line
 *  ticket, and a DoD written from a title is how bowman-ui #11 redefined its
 *  issue into a different problem (#1745 — the scope-fidelity contract asks
 *  the agent to quote the ticket's central claim, which it must be given). */
export function implementationTicketDescription(issue: {
  title: string;
  body?: string;
}): string {
  const body = issue.body?.trim() ?? "";

  if (body.length === 0) {
    return issue.title;
  }
  const capped =
    body.length > BODY_CAP
      ? `${body.slice(0, BODY_CAP)}\n\n[issue body truncated]`
      : body;

  return `${issue.title}\n\n${capped}`;
}
