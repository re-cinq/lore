/**
 * Git credential plumbing that keeps the GitHub App token off disk. The token
 * goes in as a per-invocation `http.extraheader` config override — never baked
 * into the clone URL or `.git/config`, where it would persist for the workdir's
 * lifetime and leak into any log that echoes the remote. Single-sources the
 * extraheader dance the orchestrator clone/push and the assembly-line runner
 * each hand-rolled.
 */

const DEFAULT_HOST = "github.com";

/**
 * `git -c http.https://<host>/.extraheader=Authorization: Basic <b64>` args
 * carrying the token. Spread into a `git` argv before the subcommand
 * (`git ...gitAuthArgs(token) clone <url>`).
 */
export function gitAuthArgs(token: string, host = DEFAULT_HOST): string[] {
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return ["-c", `http.https://${host}/.extraheader=${header}`];
}

/** Credential-free HTTPS clone URL — the token rides in gitAuthArgs, not here. */
export function repoCloneUrl(repo: string, host = DEFAULT_HOST): string {
  return `https://${host}/${repo}.git`;
}
