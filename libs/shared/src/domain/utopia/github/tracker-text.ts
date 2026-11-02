// One pull request or issue as GitHub records it, as the text an `api` Utopia source takes: its number, title, state, author, labels and times, its page, then its description whole.

import type { IngestDocument } from "../memory/memory-documents.js";
import { markdownDocument, type Field } from "../markdown.js";
import {
  githubPage,
  issueName,
  markdownFilename,
  pullRequestName,
} from "../names.js";

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
  const filenameId = `${entry.kind === "pull" ? "pr" : "issue"}-${entry.number}`;

  return {
    external_id: `${entry.kind}:${entry.number}`,
    filename: markdownFilename(filenameId, entry.title),
    content: markdownDocument(
      entry.title,
      trackedFields(repo, entry),
      entry.body,
    ),
    doc_time: entry.updatedAt,
  };
}

function trackedFields(repo: string, entry: TrackedEntry): Field[] {
  const label = entry.kind === "pull" ? "Pull request" : "Issue";
  const page = githubPage(
    entry.kind === "pull"
      ? pullRequestName(repo, entry.number)
      : issueName(repo, entry.number),
  );

  return [
    [label, `#${entry.number} in ${repo}`],
    ["State", stateOf(entry)],
    ["Author", entry.author],
    ...(entry.labels.length
      ? [["Labels", entry.labels.join(", ")] as Field]
      : []),
    ...timeFields(entry),
    ["Link", page],
  ];
}

function timeFields(entry: TrackedEntry): Field[] {
  const times: Array<[string, string | null]> = [
    ["Opened", entry.openedAt],
    ["Closed", entry.closedAt],
    ["Merged", entry.mergedAt],
  ];

  return times.flatMap(([name, time]) => (time ? [[name, time] as Field] : []));
}

function stateOf(entry: TrackedEntry): string {
  if (entry.mergedAt) {
    return "merged";
  }

  return entry.closedAt ? "closed" : "open";
}
