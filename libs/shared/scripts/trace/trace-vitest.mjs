import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function createTraceVitest(root, pkg, coverage) {
  const pkgDir = join(root, pkg);
  const entry = createRequire(join(pkgDir, "package.json")).resolve(
    "vitest/node",
  );
  const { createVitest } = await import(pathToFileURL(entry).href);

  return createVitest("test", {
    root: pkgDir,
    watch: false,
    includeTaskLocation: true,
    reporters: coverage ? [{ onCoverage: coverage.onCoverage }] : [],
    coverage: {
      enabled: Boolean(coverage),
      provider: "v8",
      reporter: [],
      include: ["src/**"],
      cleanOnRerun: true,
      ...(coverage ? { reportsDirectory: coverage.directory } : {}),
      thresholds: { lines: 0, functions: 0, statements: 0, branches: 0 },
    },
  });
}
