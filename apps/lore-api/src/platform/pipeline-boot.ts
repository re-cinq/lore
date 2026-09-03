// Lazy singleton for org-wide pipeline repositories; must initialize after getPool() is ready

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";

let singleton: PipelineRepositories | undefined;

export const pipelineRepositories = (): PipelineRepositories =>
  (singleton ??= createPipelineRepositories(getPool()));
