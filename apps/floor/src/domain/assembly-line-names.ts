/** The builtin assembly line names (task types with an assembly line), loaded + cached once. A job service rather than substrate: the set of line names decides job routing, and only the watcher and the wiring root ask for it. */

import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";

let assemblyLineNamesCache: Promise<ReadonlySet<string>> | undefined;

export function assemblyLineNames(): Promise<ReadonlySet<string>> {
  return (assemblyLineNamesCache ??= loadBuiltinAssemblyLines().then(
    (m) => new Set(m.keys()),
  ));
}
