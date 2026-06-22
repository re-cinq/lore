/**
 * Remote server entrypoint (GKE): serves the REST /api/* backend over HTTP.
 * The local stdio adapter (server-local.ts) proxies to this. Requires a
 * Postgres pool via LORE_DB_HOST.
 */
import { boot } from "./boot.js";
import { startHttpServer } from "./remote/http-server.js";

async function main() {
  const getPool = await boot();
  await startHttpServer(getPool);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
