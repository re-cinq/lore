// The org setting `slack_users` (GitHub login → Slack user id) as the settings page edits it: one `github-login U0123ABC` pair per line (specs/daily-digest FR12).

const SLACK_USER_ID = /^[UW][A-Z0-9]+$/;

export interface ParsedSlackPeople {
  people: Record<string, string>;
  /** Every non-blank line that is not `login id`, as typed — shown back rather than silently dropped. */
  rejected: string[];
}

/** The lines a person typed, as the map the API stores plus the lines it could not read. */
export function parseSlackPeople(text: string): ParsedSlackPeople {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs = lines.map((line) => line.split(/\s+/));
  const valid = pairs.filter(isPair);

  return {
    people: Object.fromEntries(valid),
    rejected: lines.filter((_, index) => !isPair(pairs[index])),
  };
}

function isPair(parts: string[]): parts is [string, string] {
  return parts.length === 2 && SLACK_USER_ID.test(parts[1]);
}

/** The stored map as the lines the form shows; an unreadable value shows as nothing to fix rather than breaking the page. */
export function formatSlackPeople(stored: string | undefined): string {
  try {
    const map = JSON.parse(stored || "{}") as Record<string, string>;

    return Object.entries(map)
      .map(([login, id]) => `${login} ${id}`)
      .join("\n");
  } catch {
    return "";
  }
}
