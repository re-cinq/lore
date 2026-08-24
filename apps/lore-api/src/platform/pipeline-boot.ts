// The lore-api process's one binding of the org-wide pipeline.* repositories.
//
// Lazy for the same reason every Floor accessor is: `getPool()` throws until the
// server has initialized it, so construction has to wait for first use rather
// than run at import. Memoized because `projectFor` builds a Project per REQUEST
// and these tables are not repo-scoped — rebuilding eight adapters per request
// to read org-wide rows is the waste the bundle exists to end.
//
// Never call this at module scope; that would run before the pool exists.

import { createPipelineRepositories } from "@re-cinq/lore-shared/project/pipeline/pipeline-repositories-pg.js";
import type { PipelineRepositories } from "@re-cinq/lore-shared";
import { getPool } from "@re-cinq/lore-server-core/platform/db.js";

let singleton: PipelineRepositories | undefined;

export const pipelineRepositories = (): PipelineRepositories =>
  (singleton ??= createPipelineRepositories(getPool()));
