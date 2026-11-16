import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLANNING_PACKAGES = [
  "@re-cinq/planning-document",
  "@re-cinq/planning-editor",
];

/** The version of each planning-station package installed under `root`, read when the UI is built (next.config.ts bakes it into LORE_UI_PACKAGES). */
export function planningPackageVersions(root: string): Record<string, string> {
  const manifests = PLANNING_PACKAGES.map((name) =>
    join(root, "node_modules", name, "package.json"),
  ).filter(existsSync);

  return Object.fromEntries(
    manifests.map((path) => {
      const { name, version } = JSON.parse(readFileSync(path, "utf8")) as {
        name: string;
        version: string;
      };

      return [name, version];
    }),
  );
}
