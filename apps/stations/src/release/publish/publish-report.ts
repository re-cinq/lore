import type { Report } from "@re-cinq/floor-station";
import { errorMessage } from "@re-cinq/lore-shared";
import type { MirrorPushOutcome } from "@re-cinq/lore-shared/project/workspace/mirror-push-port.js";

export interface PublishedRelease {
  repo: string;
  mirror: string;
  sha: string;
  version: string;
}

/** The mirror a private repository publishes to, null when its settings name none. */
export function mirrorOf(
  settings: Record<string, unknown> | null,
): string | null {
  const mirror = settings?.public_mirror;

  return typeof mirror === "string" ? mirror : null;
}

/** `failed` unless the mirror's `LORE_MIRROR` variable is exactly `true`, the switch that keeps its own workflows off. A null read is a missing variable or a repository the App cannot see, which the read cannot tell apart, so its reason covers both. */
export function mirrorStatusReport(
  mirror: string,
  variable: string | null,
): Report | null {
  if (variable === "true") {
    return null;
  }

  return {
    outcome: "failed",
    error:
      variable === null
        ? `${mirror} has no Actions variable LORE_MIRROR: set it to true on that repository, and check the GitHub App is installed on it with Contents, Workflows and Variables access`
        : `the workflows of ${mirror} are not switched off: its Actions variable LORE_MIRROR is ${variable}, not true`,
  };
}

export function missingInstallationReport(mirror: string): Report {
  return {
    outcome: "failed",
    error: `the GitHub App cannot read ${mirror}: install it on that repository with Contents, Workflows and Variables access`,
  };
}

/** Success for a push done or already there; a refusal names both repositories and the commit and says nothing was changed. */
export function publishReport(
  outcome: MirrorPushOutcome,
  { repo, mirror, sha, version }: PublishedRelease,
): Report {
  if (outcome.kind === "target-diverged") {
    return failed(
      `${mirror} main is at ${outcome.targetHead}, which is not an ancestor of ${sha} from ${repo}`,
    );
  }

  if (outcome.kind === "tag-at-other-sha") {
    return failed(
      `tag ${version} already sits at ${outcome.tagSha} on ${mirror}, not at ${sha} from ${repo}`,
    );
  }

  return { outcome: "success", produced: { published_to: mirror } };
}

function failed(reason: string): Report {
  return {
    outcome: "failed",
    error: `${reason}; the mirror was left as it was`,
  };
}

/** GitHub answers 403 or 404 for a repository the App is not installed on; any other failure is reported as it is. */
export function failureReport(err: unknown, mirror: string): Report {
  const status = (err as { status?: number } | null)?.status;

  return status === 403 || status === 404
    ? missingInstallationReport(mirror)
    : { outcome: "failed", error: errorMessage(err) };
}
