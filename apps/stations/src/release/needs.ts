import type { Brief, Report } from "@re-cinq/floor-station";

/** `failed` naming every need the run did not bring, null when all are there. */
export function absentNeedsReport(
  needs: Brief["needs"],
  required: string[],
): Report | null {
  const absent = required.filter((name) => !(name in needs));

  return absent.length === 0
    ? null
    : { outcome: "failed", error: `the run lacks ${absent.join(", ")}` };
}

/** The need's text, or null when the run did not bring it. */
export function optionalNeed(
  needs: Brief["needs"],
  name: string,
): string | null {
  return name in needs ? needs[name] : null;
}
