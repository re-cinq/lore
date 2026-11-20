import type { ResolvedReleaseSettings } from "../../domain/release-settings.js";
import { decideScheduleDue } from "../digest/decide-due.js";

/** Whether a repo's scheduled release is due now (specs/scheduled-releases): on its days at or after its local time, once per local day, never when disabled. */

export interface ReleaseDueInput {
  settings: ResolvedReleaseSettings;
  now: Date;
  lastReleasedAt: Date | null;
}

export function decideReleaseDue({
  settings,
  now,
  lastReleasedAt,
}: ReleaseDueInput): boolean {
  return decideScheduleDue(settings, now, lastReleasedAt);
}
