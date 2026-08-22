// The router's binding of the org-wide `pipeline.*` repositories.
//
// Lazy for the same reason the Floor's is: `getPool()` throws until `initPool()`
// has run at boot, so construction waits for first use. Never call this at
// module scope.
//
// The router only ever uses `eventQueue` today. It takes the whole bundle
// anyway because that is the one way these adapters are constructed
// (ADR-024) — a second, narrower construction here would be a second place for
// the pool wiring to drift.

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { getPool } from "./db.js";

let pipelineSingleton: PipelineRepositories | undefined;

export const pipeline = (): PipelineRepositories =>
  (pipelineSingleton ??= createPipelineRepositories(getPool()));
