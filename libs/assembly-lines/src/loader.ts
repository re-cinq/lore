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

// YAML syntax only. The parser's own message is kept and tagged with the file, since "bad indentation at line 12" is the whole diagnosis and rewording it would lose the line number.
function readYaml(yamlSrc: string, source: string): unknown {
  try {
    return parseYaml(yamlSrc);
  } catch (err) {
    throw new AssemblyLineLoadError(
      `Invalid YAML: ${(err as Error).message}`,
      source,
    );
  }
}

// Shape only — the graph checks come after. Every issue is reported at once rather than the first: a hand-authored definition usually has more than one, and one round trip per field is a poor way to learn the schema.
function checkSchema(raw: unknown, source: string): AssemblyLine {
  const parsed = AssemblyLineSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    throw new AssemblyLineLoadError(`Schema violation: ${issues}`, source);
  }

  return parsed.data;
}

// Parses and fully validates an assembly line definition; throws AssemblyLineLoadError on malformed YAML, schema violation, dangling/unreachable nodes, non-exit terminal nodes, uncovered outcomes, or unbounded back-edges.
export function parseAssemblyLine(
  yamlSrc: string,
  source = "<inline>",
): AssemblyLine {
  const wf = checkSchema(readYaml(yamlSrc, source), source);

  validateAssemblyLine(wf, source);

  return wf;
}

export async function loadAssemblyLineFile(
  filepath: string,
): Promise<AssemblyLine> {
  const yamlSrc = await fs.readFile(filepath, "utf-8");

  return parseAssemblyLine(yamlSrc, filepath);
}

// The YAML files in `dir`, or none when the directory does not exist. A missing directory is not an error: a deployment with no custom definitions has nothing to load, which is different from a directory it could not read.
async function listYamlFiles(dir: string): Promise<string[]> {
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  return entries.filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"));
}

// Loads every `*.yaml`/`*.yml` file under `dir` into a map keyed by assembly-line name; fail-fast on any invalid file or duplicate name.
export async function loadAssemblyLineDir(
  dir: string,
): Promise<Map<string, AssemblyLine>> {
  const yamls = await listYamlFiles(dir);
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
