import { createDgraphClient } from "../../dgraph-client.js";
import { DgraphTrace } from "./trace-dgraph.js";
import type { TracePort } from "./trace-port.js";

/** The trace port this process's environment configures, or null when LORE_DGRAPH_HTTP names no graph. */
export function traceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TracePort | null {
  const dgraph = createDgraphClient(env);

  return dgraph ? new DgraphTrace(dgraph) : null;
}
