import type { DgraphClientPort, DgraphTxn } from "./memory-store.js";

/** Runs `fn` inside a fresh dgraph transaction, discarding it (swallowing the discard error) once `fn` settles. */
export async function withTxn<T>(
  client: DgraphClientPort,
  fn: (txn: DgraphTxn) => Promise<T>,
): Promise<T> {
  const txn = client.newTxn();

  try {
    return await fn(txn);
  } finally {
    await txn.discard().catch(() => {});
  }
}
