/** A repository's `lore.repos.settings` however it was handed over: the column as an object, or as its JSON text; unreadable text reads as no settings. */
export function parsedSettings(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
