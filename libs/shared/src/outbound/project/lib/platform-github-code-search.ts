// The context builder's text search of a repository: the files holding a term, with the fragment GitHub matched, for a fact that lives in a string and not in a path.
import type { Octokit } from "octokit";
import type { CodeMatch } from "./github-port.js";

/** GitHub's code search allows 10 calls a minute per token, so a term gets one page of a few files. */
const FILES_PER_TERM = 5;

/** `text_matches` come only under this media type. */
const TEXT_MATCH_MEDIA = "application/vnd.github.text-match+json";

interface CodeResult {
  path: string;
  text_matches?: Array<{ fragment?: string }>;
}

export async function searchCode(
  ok: Octokit,
  repo: string,
  term: string,
): Promise<CodeMatch[]> {
  const { search } = ok.rest;
  const { data: page } = await search.code({
    q: `${JSON.stringify(term)} repo:${repo}`,
    per_page: FILES_PER_TERM,
    headers: { accept: TEXT_MATCH_MEDIA },
  });

  return (page.items as CodeResult[]).map((found) => ({
    path: found.path,
    text: (found.text_matches ?? [])
      .map((match) => match.fragment ?? "")
      .join("\n"),
  }));
}
