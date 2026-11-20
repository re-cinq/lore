import { enforceTrue } from "../../lib/enforce.js";

/** The next release tag (specs/scheduled-releases): the agent only classifies the bump, this code computes the version. */

export type Bump = "major" | "minor" | "patch";

type Version = [major: number, minor: number, patch: number];

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The greatest tag of the exact form `vX.Y.Z`, compared part by part as numbers; every other tag is ignored. */
export function latestVersionTag(tags: string[]): string | null {
  const versions = tags.flatMap((tag) => {
    const version = versionOf(tag);

    return version ? [{ tag, version }] : [];
  });
  const latest = versions
    .sort((a, b) => compareVersions(b.version, a.version))
    .at(0);

  return latest?.tag ?? null;
}

export function nextVersion(lastTag: string | null, bump: Bump): string {
  if (lastTag === null) {
    return "v0.1.0";
  }
  const last = versionOf(lastTag);

  enforceTrue(
    last,
    Error,
    `last release tag ${lastTag} is not of the form vX.Y.Z`,
  );
  const [major, minor, patch] = last;
  const next: Record<Bump, Version> = {
    major: [major + 1, 0, 0],
    minor: [major, minor + 1, 0],
    patch: [major, minor, patch + 1],
  };

  return `v${next[bump].join(".")}`;
}

function versionOf(tag: string): Version | null {
  const match = VERSION_TAG.exec(tag);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
