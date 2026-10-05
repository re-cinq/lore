/** Absent, empty and whitespace all mean "no dashboard deployed" — `reuse_values` makes the disabled case an empty string rather than a missing key. */
export function headlampUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.HEADLAMP_URL?.trim() || undefined;
}
