// Where the upkeep detectors read a repository's specs from: the spec paths from the chunk store this process holds, each spec's statements from the traceability graph through lore-api (this service holds no graph client).
import { createStationProject } from "@re-cinq/lore-shared";
import type { UpkeepSources } from "@re-cinq/lore-shared/spec-upkeep/findings.js";
import { projectFor } from "../outbound/project-boot.js";

export function upkeepSourcesFor(repo: string): UpkeepSources {
  return {
    specPaths: async () => {
      const chunks = await (await projectFor(repo)).chunks.specChunks();

      return [...new Set(chunks.map((chunk) => chunk.filePath))].sort();
    },
    document: (specPath) => createStationProject(repo).trace.document(specPath),
  };
}
