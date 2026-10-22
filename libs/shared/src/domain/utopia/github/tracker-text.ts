// One pull request or issue as GitHub records it, as the text an `api` Utopia source takes: its number, title, state, author, labels and times, its page, then its description whole.

import type { IngestDocument } from "../memory/memory-documents.js";
import { githubPage, issueName, pullRequestName } from "../names.js";

export type TrackedKind = "pull" | "issue";

export interface TrackedEntry {
  kind: TrackedKind;
  number: number;
  title: string;
  body: string;
  /** The GitHub login that opened it. */
  author: string;
  labels: string[];
  /** RFC 3339, as are the other times. */
  openedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  /** The document's doc_time, and the walk's cursor. */
  updatedAt: string;
}

export function trackerDocument(
  repo: string,
  entry: TrackedEntry,
): IngestDocument {
  const page = githubPage(
    entry.kind === "pull"
      ? pullRequestName(repo, entry.number)
      : issueName(repo, entry.number),
  );

  return {
    external_id: `${entry.kind}:${entry.number}`,
    filename: `${entry.kind}-${entry.number}`,
    content: [...trackedHead(repo, entry, page), entry.body]
      .filter((part) => part !== "")
      .join("\n\n"),
    doc_time: entry.updatedAt,
  };
}

function trackedHead(
  repo: string,
  entry: TrackedEntry,
  page: string,
): string[] {
  const label = entry.kind === "pull" ? "Pull request" : "Issue";
  const lines = [
    `${label} #${entry.number} in ${repo}: ${entry.title}`,
    `State: ${stateOf(entry)}`,
    `Author: ${entry.author}`,
    ...(entry.labels.length ? [`Labels: ${entry.labels.join(", ")}`] : []),
    ...timeLines(entry),
    `Link: ${page}`,
  ];

  return [lines.join("\n")];
}

function timeLines(entry: TrackedEntry): string[] {
  const times: Array<[string, string | null]> = [
    ["Opened", entry.openedAt],
    ["Closed", entry.closedAt],
    ["Merged", entry.mergedAt],
  ];

  return times.flatMap(([name, time]) => (time ? [`${name}: ${time}`] : []));
}

function stateOf(entry: TrackedEntry): string {
  if (entry.mergedAt) {
    return "merged";
  }

  return entry.closedAt ? "closed" : "open";
}
