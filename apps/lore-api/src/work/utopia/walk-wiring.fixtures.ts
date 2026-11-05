import { createServer, type IncomingMessage, type Server } from "node:http";
import { vi } from "vitest";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { makePool } from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

export const SETTINGS_WITH_BASE = {
  utopia: {
    kb_id: "kb-1",
    ontology_version: 9,
    sources_extract_off: true,
    history_sources_split: true,
  },
};

/** A Utopia that answers every push created and remembers `<url> <external id>` of each, with the environment pointed at it. */
export async function startFakeUtopia() {
  const pushes: string[] = [];
  const server = fakeUtopiaServer(pushes);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  enforceTrue(
    !(address === null || typeof address === "string"),
    Error,
    "no server address",
  );
  pointEnvAt(address.port);

  return {
    pushes,
    stop: () => {
      vi.unstubAllEnvs();

      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function pointEnvAt(port: number): void {
  vi.stubEnv("UTOPIA_API_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("UTOPIA_TOKEN", "utp_pat_lore");
  vi.stubEnv("UTOPIA_WORKSPACE_ID", "ws-lore");
}

function fakeUtopiaServer(pushes: string[]): Server {
  return createServer((req, res) => {
    void pushedExternalId(req).then((externalId) => {
      pushes.push(`${req.url} ${externalId}`);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ action: "created" }));
    });
  });
}

async function pushedExternalId(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }

  return (
    JSON.parse(Buffer.concat(chunks).toString()) as { external_id: string }
  ).external_id;
}

/** A pool whose repos hold a source in kb-1 for every kind asked for, named src-<kind>. */
export function poolHoldingSources(kinds: string[]): Pool {
  const pool = makePool();

  pool.query.mockImplementation(async (sql: string, params: string[]) => {
    const held = /FROM lore\.utopia_kind_sources/.test(sql);

    return {
      rows:
        held && kinds.includes(params[1])
          ? [{ id: `src-${params[1]}`, key: `utp_${params[1]}`, kbId: "kb-1" }]
          : [],
    };
  });

  return pool as unknown as Pool;
}
