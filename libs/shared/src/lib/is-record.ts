/** The one "is this a JSON object?" guard — arrays are EXCLUDED, since `typeof [] === "object"` would otherwise admit them and reads off them would silently come back undefined. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
