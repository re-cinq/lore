// A plan's page in the web UI: what a story issue links to, and what a spec statement cites a plan block under.

export function planUrlOf(
  uiUrl: string | undefined,
  repo: string,
  planId: string,
): string | undefined {
  return uiUrl
    ? `${uiUrl.replace(/\/+$/, "")}/repos/${repo}/plans/${planId}`
    : undefined;
}
