// How much of an issue body a ticket description carries — issue bodies are unbounded (~40KB seen) and rendered into every loop pod's prompt, so the tail past the cap is cut and marked; the pod can still read the rest via the issue URL.
const BODY_CAP = 16_000;

// The ticket text an implementation-loop pod defines done against: title AND body — `picked.title` alone gave the DoD node a one-line ticket, which is how bowman-ui #11 redefined its issue into a different problem (#1745).
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
