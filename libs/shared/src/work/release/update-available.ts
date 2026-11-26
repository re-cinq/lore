import { compareVersions, versionOf } from "./next-version.js";

/** True only when both are `vX.Y.Z` tags and `latest` is the greater: a build named by its SHA never has an update to take. */
export function updateAvailable(running: string, latest: string | null) {
  const runningVersion = versionOf(running);
  const latestVersion = latest === null ? null : versionOf(latest);

  return (
    runningVersion !== null &&
    latestVersion !== null &&
    compareVersions(latestVersion, runningVersion) > 0
  );
}
