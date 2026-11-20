// The release block of the settings form (specs/scheduled-releases): every field of the release card.

import type { components } from "@/lib/api/schema";
import { parseSchedule } from "./schedule-form";

export type ReleaseBlock = NonNullable<
  NonNullable<components["schemas"]["Repo"]["settings"]>["release"]
>;

/** What an unset field shows. Web-ui cannot import the library, so this mirrors `RELEASE_DEFAULTS` in libs/shared/src/domain/release-settings.ts; settings-release.test.ts fails the build when the two drift. */
export const RELEASE_DEFAULTS: Required<ReleaseBlock> = {
  enabled: false,
  days: [1],
  time: "09:00",
  timezone: "Europe/Berlin",
};

/** The card's fields, or undefined when the form has none or they equal what is stored (lore-api merges the block key by key). */
export function parseReleasePatch(
  formData: FormData,
  stored: ReleaseBlock | null | undefined,
): Required<ReleaseBlock> | undefined {
  if (!formData.has("release_time")) {
    return undefined;
  }
  const typed = {
    enabled: formData.get("release_enabled") === "on",
    ...parseSchedule(formData, "release", RELEASE_DEFAULTS),
  };
  const current = { ...RELEASE_DEFAULTS, ...stored };

  return sameRelease(typed, current) ? undefined : typed;
}

function sameRelease(
  left: Required<ReleaseBlock>,
  right: Required<ReleaseBlock>,
): boolean {
  const sortedDays = (block: Required<ReleaseBlock>) =>
    [...block.days].sort().join();

  return (
    left.enabled === right.enabled &&
    left.time === right.time &&
    left.timezone === right.timezone &&
    sortedDays(left) === sortedDays(right)
  );
}
