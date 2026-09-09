import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type {
  Lifecycle,
  Request,
  ResponseObject,
  ResponseToolkit,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { DB_UNAVAILABLE } from "./common-schemas.js";

/** A route handler that has already been handed a live pool. */
export type PooledHandler = (
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) => Promise<ResponseObject>;

/** Every DB-backed route answers 503 when there is no pool — stated once here instead of at the top of each handler. */
export function withPool(
  getPool: () => Pool | null,
  serve: PooledHandler,
): Lifecycle.Method {
  return (request, h) => {
    const pool = getPool();

    enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

    return serve(pool, request, h);
  };
}
