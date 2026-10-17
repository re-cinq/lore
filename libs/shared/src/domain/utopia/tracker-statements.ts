// One pull request or issue as GitHub records it, as a Utopia statement item: its stub (what a commit message tells of it) with its title, state, author, labels and times, its description as text, and, for a pull request, the issues and the Lore task its description names.

import {
  cutText,
  joinFragments,
  splitToFit,
  type Fragment,
} from "./fragments.js";
import {
  bodyLinks,
  trackedName,
  trackedStub,
  type TrackedKind,
} from "./pull-request-links.js";
import { attribute, type Statement, type StatementItem } from "./statements.js";

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
  /** The item's doc_time, and the walk's cursor. */
  updatedAt: string;
}

export function trackerItems(
  repo: string,
  entry: TrackedEntry,
): StatementItem[] {
  const name = trackedName(repo, entry.kind, entry.number);
  const stub = trackedStub(repo, entry.kind, entry.number);
  const head: Fragment = {
    e: [[repo, "Repository", true], ...stub.e],
    s: [...stub.s, ...entryAttributes(name, entry)],
  };
  const parts = [
    ...textFragment(name, entry.body),
    ...(entry.kind === "pull" ? bodyLinks(repo, name, entry.body) : []),
  ];

  return splitToFit(`${entry.kind}:${entry.number}`, parts, (part) => ({
    doc_time: entry.updatedAt,
    ...joinFragments(head, part),
  }));
}

function entryAttributes(name: string, entry: TrackedEntry): Statement[] {
  const optional: Array<[string, string | null]> = [
    ["labels", entry.labels.length ? entry.labels.join(", ") : null],
    ["closed_at", entry.closedAt],
    ["merged_at", entry.mergedAt],
  ];

  return [
    attribute(name, "title", entry.title),
    attribute(name, "state", stateOf(entry)),
    attribute(name, "author", entry.author),
    attribute(name, "opened_at", entry.openedAt),
    ...optional
      .filter((pair): pair is [string, string] => pair[1] !== null)
      .map(([phrase, value]) => attribute(name, phrase, value)),
  ];
}

function stateOf(entry: TrackedEntry): string {
  if (entry.mergedAt) {
    return "merged";
  }

  return entry.closedAt ? "closed" : "open";
}

/** The description is a part, not head: a split item carries it on its first item only (FR2.9). */
function textFragment(name: string, body: string): Fragment[] {
  const text = cutText(body);

  return text ? [{ e: [], s: [attribute(name, "text", text)] }] : [];
}
