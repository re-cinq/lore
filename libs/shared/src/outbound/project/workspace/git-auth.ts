/** Git credential plumbing that keeps the GitHub App token off disk via a per-invocation `http.extraheader` override, never baked into the clone URL or `.git/config`. */

import { githubHost } from "../../../domain/github-host.js";

/** `git -c http.https://<host>/.extraheader=Authorization: Basic <b64>` args carrying the token; spread into a `git` argv before the subcommand. */
export function gitAuthArgs(token: string, host = githubHost()): string[] {
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

  return ["-c", `http.https://${host}/.extraheader=${header}`];
}

/** Credential-free HTTPS clone URL — the token rides in gitAuthArgs, not here. */
export function repoCloneUrl(repo: string, host = githubHost()): string {
  return `https://${host}/${repo}.git`;
}
