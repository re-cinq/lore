// The Utopia arm's `history` section (specs/utopia-graph-mirror FR13.11): the commits of the repo's `git-history` source that changed a file the ticket names, each with the pull request, issues and files its text links (FR12.3), so a file in the context brings its last changes along.

import type {
  SearchHit,
  SearchPage,
} from "../../../domain/utopia/read-shapes.js";
import type { SourceItem } from "./context-assembly-format.js";
import { mkItem, normalizeScores } from "./context-assembly-items.js";
import type { FetchResult } from "./context-assembly-types.js";

const HISTORY_LIMIT = 3;

/** The line is a list item in a commit's markdown, and a bare line in the plain text pushed before it. */
const FILES_LINE_RE = /^(?:- \*\*)?Files changed:(?:\*\*)? (.*)$/m;

export interface HistorySearch {
  sourceId: string;
  /** Both pages of a search by the ticket's file names. */
  pages(query: string): Promise<SearchHit[]>;
  /** The stored text of a commit, or null when Utopia no longer holds it. */
  whole(externalId: string): Promise<string | null>;
}

/** The history section for a ticket's file names: empty without a name, asking Utopia nothing; disabled without a git-history source. */
export async function historySection(
  search: HistorySearch | null,
  files: string[],
): Promise<FetchResult> {
  if (!search) {
    return { sources: [], status: "disabled" };
  }

  if (files.length === 0) {
    return { sources: [], status: "empty" };
  }
  const hits = await search.pages(files.join(" "));
  const sources = await Promise.all(
    commitItems(hits, search.sourceId, files).map((commit) =>
      wholeCommit(commit, search),
    ),
  );

  return { sources, status: sources.length > 0 ? "ok" : "empty" };
}

/** One item per commit in the rank of its best hit, kept only when its `Files changed:` line names one of the files: a commit whose message merely mentions a name changed something else. */
function commitItems(
  hits: SearchHit[],
  sourceId: string,
  files: string[],
): SourceItem[] {
  const commits = hits.filter(
    (hit) =>
      hit.sourceId === sourceId &&
      hit.externalId?.startsWith("commit:") &&
      changesAny(hit.text, files),
  );
  const firstOfEach = [
    ...new Map(commits.reverse().map((hit) => [hit.externalId, hit])),
  ].reverse();

  return normalizeScores(firstOfEach.slice(0, HISTORY_LIMIT).map(toItem));
}

/** A hit is the chunk the search matched, often the `Files changed:` line alone; the commit is read whole so its subject and pull request come along. */
async function wholeCommit(
  commit: SourceItem,
  search: HistorySearch,
): Promise<SourceItem> {
  const text = await search.whole(commit.source_path ?? "");

  return text ? { ...commit, text } : commit;
}

function toItem([id, hit]: [string | null, SearchHit]): SourceItem {
  return mkItem(hit.text, {
    source_path: id ?? "",
    content_type: "history",
    score: hit.score,
  });
}

function changesAny(text: string, files: string[]): boolean {
  const filesLine = FILES_LINE_RE.exec(text);
  const changed = filesLine?.[1] ? filesLine[1].split(", ") : [];

  return changed.some((path) =>
    files.some((file) => path === file || path.endsWith(`/${file}`)),
  );
}

/** Both pages of a search, asked together. */
export async function bothPages(
  page: (index: number) => Promise<SearchPage>,
): Promise<SearchHit[]> {
  const [first, second] = await Promise.all([
    page(0),
    page(1).catch(() => null),
  ]);

  return [...first.hits, ...(first.hasMore && second ? second.hits : [])];
}
