// What a section of the Loops tab says when it shows no row: which loops it is still waiting for, or else what would put work there. Pure.
import type { LoopRead, SectionKey } from "./board";

/** What puts work in each loop's backlog, said when the backlog is empty. */
const BACKLOG_HINT: Record<string, string> = {
  implementation:
    "Label an issue priority:high, priority:medium, or priority:low to queue it.",
  review: "Every open pull request no review has looked at waits here.",
  merge:
    "Every open pull request Lore's review approved waits here until the auto-merge loop takes it.",
  triage: "Label an issue triage: needs-triage to have it triaged.",
  upkeep: "Spec upkeep has no backlog: it runs every Monday.",
  digest: "The daily digest has no backlog: it posts on its schedule.",
  tickets: "Spec tickets has no backlog: it starts when a spec merges.",
};

/** A section with no row while loops are loading waits for them; once none is, it says what would fill it. */
export function sectionEmptyText(
  key: SectionKey,
  reads: readonly LoopRead[],
  waitingFor: readonly string[],
): string {
  return waitingFor.length
    ? `Loading ${listed(waitingFor)}…`
    : emptyText(key, reads);
}

/** Each empty text says what would put work here rather than just "none": an empty section usually means the reader has something to do. */
function emptyText(key: SectionKey, reads: readonly LoopRead[]): string {
  if (key === "current") {
    return "Nothing is being worked right now.";
  }

  if (key === "backlog") {
    return [
      "The backlog is empty.",
      ...reads.map((r) => BACKLOG_HINT[r.loop.key]),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return "Nothing addressed yet.";
}

/** `A`, `A and B`, `A, B and C`. */
function listed(names: readonly string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
