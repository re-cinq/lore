// Where a new test file may go: under a folder that already holds tests, the folders CI runs. The grounding of a generated text reports one anywhere else.

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?|_test\.go)$/;

interface TestFolderFinding {
  name: string;
  kind: "test-folder";
}

/** A new test file belongs under a folder that already holds tests, the folders CI runs; one anywhere else is never run, and the orphaned-tests check refuses it. A tree with no tests says nothing about where they run. */
export function untestedFolders(
  tree: readonly string[],
  paths: readonly string[],
): TestFolderFinding[] {
  if (!tree.some((entry) => TEST_FILE.test(entry))) {
    return [];
  }

  return paths
    .filter((path) => TEST_FILE.test(path) && !tree.includes(path))
    .filter((path) => !holdsTests(tree, path))
    .map((name) => ({ name, kind: "test-folder" as const }));
}

function holdsTests(tree: readonly string[], path: string): boolean {
  const segments = path.split("/").slice(0, -1);

  return segments.slice(1).some((_, index) => {
    const folder = `${segments.slice(0, index + 2).join("/")}/`;

    return tree.some(
      (entry) => entry.startsWith(folder) && TEST_FILE.test(entry),
    );
  });
}
