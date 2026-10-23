/** The per-repo `auto_review` opt-in, the code-review loop's switch, read off the repository's settings however they were stored; off by omission. */
export function autoReviewEnabled(rawSettings: unknown): boolean {
  const parsed =
    typeof rawSettings === "string" ? parsedJson(rawSettings) : rawSettings;

  return (parsed as { auto_review?: boolean } | null)?.auto_review === true;
}

function parsedJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
