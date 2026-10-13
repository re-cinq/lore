// The shipped default agents: libs/shared/src/agent-defaults/*.md, copied beside dist by the build.

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAgentDefaultFile } from "../../../domain/agent-defaults/agent-default-file.js";
import type { ResolvedAgentDefinition } from "../../../domain/models/agent-definition.js";

const SHIPPED_DIR = fileURLToPath(
  new URL("../../../agent-defaults/", import.meta.url),
);

export function loadAgentDefaults(
  dir: string = SHIPPED_DIR,
): ResolvedAgentDefinition[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) =>
      parseAgentDefaultFile(
        basename(file, ".md"),
        readFileSync(join(dir, file), "utf-8"),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
