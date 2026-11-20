import type { ChangelogChange } from "../../domain/models/changelog-week.js";
import { changesWhere, type ClosedWork } from "../changelog/changelog-week.js";

/** What a release carries: what merged and closed after the previous release, up to and including this one. */

export interface ReleaseWindow {
  /** Exclusive, ISO; null reaches back to the beginning. */
  since: string | null;
  /** Inclusive, ISO. */
  until: string;
}

export function releaseChanges(
  work: ClosedWork,
  { since, until }: ReleaseWindow,
): ChangelogChange[] {
  const untilTime = Date.parse(until);
  const sinceTime = since === null ? -Infinity : Date.parse(since);

  return changesWhere(work, (at) => {
    const time = Date.parse(at);

    return time > sinceTime && time <= untilTime;
  });
}
