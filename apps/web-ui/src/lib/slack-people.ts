// The org setting `slack_users` (GitHub login → Slack user id) as the settings page edits it: one `github-login U0123ABC` pair per line (specs/daily-digest FR12).

const SLACK_USER_ID = /^[UW][A-Z0-9]+$/;

/** The lines a person typed, as the map the API stores; a line that is not `login id` is dropped. */
export function parseSlackPeople(text: string): Record<string, string> {
  const pairs = text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (parts): parts is [string, string] =>
        parts.length === 2 && SLACK_USER_ID.test(parts[1]),
    );

  return Object.fromEntries(pairs);
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
