import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Tests read every workspace package from SOURCE, never from dist. A test that needed a built package needed a build, and a workspace build is the one command a 1Gi agent pod cannot run: `tsc` on libs/shared peaks near 950 MB, and run abac6ee9 died on it rebuilding shared so a Floor test could see a change it had just made (2026-09-13). The aliases are derived from each package's own export map, so a new subpath export needs no second registration here. */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The packages a test in one workspace may import from another. */
const WORKSPACE_PACKAGES = [
  "libs/shared",
  "libs/assembly-lines",
  "libs/server-core",
  "apps/stations",
] as const;

export interface SourceAlias {
  find: RegExp;
  replacement: string;
}

interface PackageManifest {
  name: string;
  exports?: Record<string, string | { default?: string }>;
}

/** Vitest `resolve.alias` entries mapping every export of every workspace package to its TypeScript source. Exact subpaths come before wildcards, and a package's catch-all `./*.js` last, so the most specific export wins as Node's own resolution would have it. */
export function workspaceSourceAliases(): SourceAlias[] {
  return WORKSPACE_PACKAGES.flatMap((dir) => aliasesOf(dir));
}

function aliasesOf(dir: string): SourceAlias[] {
  const manifest = readManifest(dir);
  const entries = Object.entries(manifest.exports ?? {}).map(
    ([subpath, target]) => ({ subpath, target: targetOf(target) }),
  );

  return [...entries]
    .sort((a, b) => specificity(b.subpath) - specificity(a.subpath))
    .map(({ subpath, target }) =>
      aliasFor(
        manifest.name,
        subpath,
        resolve(REPO_ROOT, dir, sourceOf(target)),
      ),
    );
}

function readManifest(dir: string): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, dir, "package.json"), "utf-8"),
  ) as PackageManifest;
}

function targetOf(target: string | { default?: string }): string {
  return typeof target === "string"
    ? target
    : (target.default ?? unaliasable());
}

/** An export condition with no `default` names nothing a test could import. */
function unaliasable(): never {
  throw new Error("an export with no default target cannot be aliased");
}

/** `./dist/x/y.js` → `./src/x/y.ts`; the wildcard survives the rewrite. */
function sourceOf(distPath: string): string {
  return distPath.replace(/^\.\/dist\//, "./src/").replace(/\.js$/, ".ts");
}

/** Longer, wildcard-free subpaths first; the bare catch-all `./*.js` sorts last. */
function specificity(subpath: string): number {
  const wildcardPenalty = subpath.includes("*") ? 1000 : 0;
  const catchAllPenalty = subpath === "./*.js" ? 1000 : 0;

  return subpath.length - wildcardPenalty - catchAllPenalty;
}

function aliasFor(
  packageName: string,
  subpath: string,
  sourceTarget: string,
): SourceAlias {
  const specifier =
    subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`;

  if (!subpath.includes("*")) {
    return {
      find: new RegExp(`^${escape(specifier)}$`),
      replacement: sourceTarget,
    };
  }
  const [head, tail] = specifier.split("*");
  const [targetHead, targetTail] = sourceTarget.split("*");

  return {
    find: new RegExp(`^${escape(head)}(.*)${escape(tail)}$`),
    replacement: `${targetHead}$1${targetTail}`,
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
