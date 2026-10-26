// When only a code owner's approval stands between a pull request and its merge, the owners are told once, on the pull request (#3504): a loop pull request that touched a CODEOWNERS path waited for an approval nobody had been asked for.

const MARKER = "<!-- lore:code-owner-ping -->";

/** One changed path a CODEOWNERS row assigns, with its owners as the row names them. */
export interface OwnedPath {
  path: string;
  owners: readonly string[];
}

/** What the owners are asked for: an approval where GitHub merges once it has one, an approval and the merge itself where nothing would. */
export type OwnerAsk = "approve" | "approve and merge";

const OPENING: Record<OwnerAsk, string> = {
  approve: "this pull request is ready to merge except for your approval.",
  "approve and merge":
    "this pull request is ready to merge except for your review. Nothing merges it on this branch without a person: please approve and merge it.",
};

/** The comment: each owner mentioned once, what they are asked for, the paths they own, and the marker that keeps it to one comment per pull request. */
export function codeOwnerPing(
  owned: readonly OwnedPath[],
  ask: OwnerAsk,
): string {
  const owners = [...new Set(owned.flatMap((row) => row.owners))];
  const paths = owned.map((row) => `\`${row.path}\``).join(", ");

  return [
    `${owners.join(" ")}: ${OPENING[ask]}`,
    "",
    `CI is green, Lore's review passed and every review thread is resolved. It changes ${paths}, which CODEOWNERS assigns to you.`,
    "",
    MARKER,
  ].join("\n");
}

/** True when an earlier comment already asked. */
export function askedAlready(
  comments: ReadonlyArray<{ body: string }>,
): boolean {
  return comments.some((comment) => comment.body.includes(MARKER));
}
