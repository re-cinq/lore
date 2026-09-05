/**
 * no-cross-layer-import — enforces the layering declared in `layers.yaml` at the
 * repo root. A folder may import only what its entry lists, so the architecture
 * is a file someone can read rather than a habit that erodes.
 *
 * layers.yaml maps a package directory to its folders, each folder to the
 * folders it may import:
 *
 *   apps/floor:
 *     ".":       [kernel, jobs, delivery]
 *     kernel:    []
 *     jobs/lib:  [kernel, "@re-cinq/lore-shared"]
 *     jobs/*:    [kernel, jobs/lib, "@re-cinq/lore-shared"]
 *
 * Four rules, and no others:
 *  1. A key names a LAYER — the folder it names and everything under it;
 *     `*` matches one segment, so `jobs/*` makes each domain its own layer.
 *  2. Movement inside a layer is free; the list only governs what LEAVES it.
 *  3. A layer may import what its list names, and nothing else.
 *  4. The most specific matching key wins, so `jobs/lib` beats `jobs/*`.
 *
 * Sibling isolation needs no syntax: `jobs/*` listing `kernel` lets
 * `jobs/review` reach kernel and itself, and `jobs/merge` is simply not on the
 * list. A package ABSENT from layers.yaml is not checked at all, so this lands
 * one package at a time; inside a package that IS listed, a folder with no
 * entry may import nothing, which is what keeps the file honest as code grows.
 *
 * npm and node: specifiers are never governed — package.json already owns that.
 * Cross-package `@re-cinq/*` specifiers are, written verbatim in a list.
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const CONFIG_FILE = "layers.yaml";
const cache = new Map();

/** The nearest ancestor directory holding layers.yaml, or null. */
function findConfigDir(from) {
  let dir = from;

  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function loadConfig(from) {
  const dir = findConfigDir(from);
  if (!dir) return null;
  const cached = cache.get(dir);
  if (cached) return cached;
  const parsed = parse(fs.readFileSync(path.join(dir, CONFIG_FILE), "utf8"));
  const loaded = { root: dir, layers: parsed?.layers ?? parsed ?? {} };
  cache.set(dir, loaded);

  return loaded;
}

/** The `src`-relative folder of a file inside a governed package, else null. */
function folderIn(pkg, relFile) {
  const prefix = `${pkg}/src/`;
  if (!relFile.startsWith(prefix)) return null;
  const rest = relFile.slice(prefix.length);
  const dir = path.posix.dirname(rest);

  return dir === "." ? "." : dir;
}

/** A key governs the folder it names AND everything under it, so a nested
 * folder inherits its parent's entry instead of falling through to "unlisted". */
function segmentsMatch(keySegs, folderSegs) {
  if (keySegs.length > folderSegs.length) return false;

  return keySegs.every((seg, i) => seg === "*" || seg === folderSegs[i]);
}

/** The most specific key matching this folder: longest, then fewest stars. */
function keyFor(entries, folder) {
  const folderSegs = folder === "." ? [] : folder.split("/");
  const matches = Object.keys(entries).filter((key) => {
    if (key === ".") return folder === ".";

    return segmentsMatch(key.split("/"), folderSegs);
  });

  return matches.sort((a, b) => {
    const segs = b.split("/").length - a.split("/").length;
    if (segs !== 0) return segs;

    return starCount(a) - starCount(b);
  })[0];
}

function starCount(key) {
  return key.split("/").filter((seg) => seg === "*").length;
}

/** The layer a key names for this folder, with each `*` bound to the real segment. */
function layerRoot(key, folder) {
  if (key === ".") return ".";
  const folderSegs = folder.split("/");

  return key
    .split("/")
    .map((seg, i) => (seg === "*" ? folderSegs[i] : seg))
    .join("/");
}

/** True when `target` is `base` or sits underneath it. */
function isWithin(target, base) {
  if (base === ".") return true;

  return target === base || target.startsWith(`${base}/`);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "enforce the folder layering declared in layers.yaml — a folder imports only what its entry lists",
    },
    schema: [
      {
        type: "object",
        properties: { layers: { type: "object" }, root: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      notAllowed:
        "`{{folder}}` may not import `{{target}}`. Its layers.yaml entry allows: {{allowed}}.",
      unlistedFolder:
        "`{{folder}}` has no entry in layers.yaml, so it may import nothing. Give it one, or move the code into a folder that has one.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    const inline = context.options[0]?.layers;
    const config = inline
      ? { root: context.options[0]?.root ?? process.cwd(), layers: inline }
      : loadConfig(path.dirname(path.resolve(filename)));
    if (!config) return {};

    const relFile = path
      .relative(config.root, path.resolve(config.root, filename))
      .split(path.sep)
      .join("/");
    const pkg = Object.keys(config.layers).find((p) =>
      relFile.startsWith(`${p}/src/`),
    );
    if (!pkg) return {};

    const folder = folderIn(pkg, relFile);
    if (folder === null) return {};

    const entries = config.layers[pkg];
    const key = keyFor(entries, folder);
    const allowed = key === undefined ? null : (entries[key] ?? []);
    const layer = key === undefined ? null : layerRoot(key, folder);

    // `join`, never `resolve`: resolve() with a relative base silently prepends
    // process.cwd(), so linting from a subdirectory resolved every target
    // outside the package and reported nothing at all.
    function targetFolder(spec) {
      const rel = path.posix.normalize(
        path.posix.join(path.posix.dirname(relFile), spec),
      );

      return folderIn(pkg, rel.replace(/\.(js|ts|tsx)$/, ".ts"));
    }

    function check(node, spec) {
      if (!spec.startsWith(".") && !spec.startsWith("@re-cinq/")) return;

      if (allowed === null) {
        context.report({ node, messageId: "unlistedFolder", data: { folder } });

        return;
      }
      const target = spec.startsWith("@re-cinq/")
        ? spec.split("/").slice(0, 2).join("/")
        : targetFolder(spec);
      if (target === null) return;
      const inLayer =
        !spec.startsWith("@re-cinq/") &&
        (layer === "." ? target === "." : isWithin(target, layer));
      if (inLayer) return;
      if (allowed.some((entry) => isWithin(target, entry))) return;

      context.report({
        node,
        messageId: "notAllowed",
        data: {
          folder: layer,
          target,
          allowed: allowed.length ? allowed.join(", ") : "nothing",
        },
      });
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) =>
        node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) =>
        node.source.type === "Literal" &&
        typeof node.source.value === "string" &&
        check(node, node.source.value),
    };
  },
};
