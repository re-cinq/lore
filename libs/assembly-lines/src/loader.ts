import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { validateAssemblyLine } from "./assembly-line-validate.js";
import {
  AssemblyLineSchema,
  AssemblyLineLoadError,
} from "./assembly-line-schema.js";
import type { AssemblyLine } from "./assembly-line-schema.js";

export { isThreadKey } from "./assembly-line-validate.js";
export {
  NODE_TYPES,
  uncoveredOutcomes,
  AssemblyLineLoadError,
  PARAMETERISED_NODE_TYPES,
  type NodeTypeValue,
  type AssemblyLineNode,
  type AssemblyLineEdge,
  type AssemblyLine,
  type EdgeConditionValue,
} from "./assembly-line-schema.js";

// Parses and fully validates an assembly line definition; throws AssemblyLineLoadError on malformed YAML, schema violation, dangling/unreachable nodes, non-exit terminal nodes, uncovered outcomes, or unbounded back-edges.
export function parseAssemblyLine(
  yamlSrc: string,
  source = "<inline>",
): AssemblyLine {
  let raw: unknown;

  try {
    raw = parseYaml(yamlSrc);
  } catch (err) {
    throw new AssemblyLineLoadError(
      `Invalid YAML: ${(err as Error).message}`,
      source,
    );
  }

  const parsed = AssemblyLineSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    throw new AssemblyLineLoadError(`Schema violation: ${issues}`, source);
  }

  const wf = parsed.data;

  validateAssemblyLine(wf, source);

  return wf;
}

export async function loadAssemblyLineFile(
  filepath: string,
): Promise<AssemblyLine> {
  const yamlSrc = await fs.readFile(filepath, "utf-8");

  return parseAssemblyLine(yamlSrc, filepath);
}

// Loads every `*.yaml`/`*.yml` file under `dir` into a map keyed by assembly-line name; fail-fast on any invalid file or duplicate name.
export async function loadAssemblyLineDir(
  dir: string,
): Promise<Map<string, AssemblyLine>> {
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw err;
  }
  const yamls = entries.filter(
    (e) => e.endsWith(".yaml") || e.endsWith(".yml"),
  );
  const out = new Map<string, AssemblyLine>();

  for (const f of yamls) {
    const wf = await loadAssemblyLineFile(path.join(dir, f));

    enforceTrue(
      !out.has(wf.name),
      (message) => new AssemblyLineLoadError(message, path.join(dir, f)),
      `Duplicate assemblyLine name "${wf.name}"`,
    );
    out.set(wf.name, wf);
  }

  return out;
}
