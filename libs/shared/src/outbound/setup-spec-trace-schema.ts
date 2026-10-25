import type { DgraphClientPort } from "./memory-store.js";
import { SPEC_TRACE_SCHEMA } from "./setup-spec-trace-schema.schema.js";

type AlterClient = { alter(op: { schema: string }): Promise<unknown> };

const TRANSIENT_PATTERNS = [
  /pending transactions found/i,
  /errindexinginprogress/i,
  /indexing in progress/i,
  /operation is already running/i,
];

export async function setupSpecTraceSchema(
  client: DgraphClientPort,
): Promise<void> {
  const alter = (client as unknown as AlterClient).alter.bind(
    client as unknown as AlterClient,
  );

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await alter({ schema: SPEC_TRACE_SCHEMA });
      return;
    } catch (err) {
      if (attempt >= 10 || !isTransient(err)) throw err;
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

function isTransient(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(text));
}
