/** `featureDirOf` maps a spec file's path to its owning speckit feature folder so every doc under it collapses onto one `Feature` graph node: `specs/<feature>/…` → `specs/<feature>`, other dirs → their immediate directory, repo-root files → null. */
export function featureDirOf(filePath: string): string | null {
  const segments = filePath.split("/");

  if (segments.length < 2) {
    return null;
  }

  if (segments[0] === "specs") {
    return `specs/${segments[1]}`;
  }

  return segments.slice(0, -1).join("/");
}
