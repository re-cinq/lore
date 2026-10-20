// The inbox's keys: j and k move the selection, e or Enter opens the selected run.

export type InboxKeyAction =
  { type: "move"; index: number } | { type: "open" } | null;

/** What a key does with `count` items and `selected` chosen; null for a key the inbox leaves alone. */
export function inboxKeyAction(
  key: string,
  selected: number,
  count: number,
): InboxKeyAction {
  if (count === 0) {
    return null;
  }

  if (key === "j") {
    return { type: "move", index: Math.min(selected + 1, count - 1) };
  }

  if (key === "k") {
    return { type: "move", index: Math.max(selected - 1, 0) };
  }

  return key === "e" ? { type: "open" } : null;
}
