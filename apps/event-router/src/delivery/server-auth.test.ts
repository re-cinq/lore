/**
 * The FR5 scope boundary, tested through the REAL server wiring: a per-agent
 * token authorizes the reporting front door and NOTHING else. The drain and
 * delivery surfaces guard with the plain ingest-token check and never consult
 * the cluster-agent registry — which this suite can prove without a database,
 * because `buildServer`'s registry thunk resolves through `getPool()`, and a
 * pool-free process answering 401 (not 500) means the registry was never
 * touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "./server.js";

const INGEST_TOKEN = "ingest-tok";
const AGENT_TOKEN = "lca_registered-somewhere";

let savedIngest: string | undefined;

beforeEach(() => {
  savedIngest = process.env.LORE_INGEST_TOKEN;
  process.env.LORE_INGEST_TOKEN = INGEST_TOKEN;
});

afterEach(() => {
  if (savedIngest === undefined) {
    delete process.env.LORE_INGEST_TOKEN;

    return;
  }
  process.env.LORE_INGEST_TOKEN = savedIngest;
});

describe("per-agent tokens stop at the reporting front door", () => {
  const drainSurfaces = [
    { url: "/api/events/claim", payload: JSON.stringify({ limit: 1 }) },
    { url: "/api/deliveries/claim", payload: JSON.stringify({ limit: 1 }) },
    { url: "/api/deliveries/reap", payload: JSON.stringify({}) },
  ];

  it.each(drainSurfaces)(
    "answers 401 to a per-agent bearer on $url without consulting the registry",
    async ({ url, payload }) => {
      const res = await buildServer().inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${AGENT_TOKEN}` },
        payload,
      });

      // 401, not 500: a 500 here would mean the guard reached for the
      // registry (whose pool this test process never initialized).
      expect(res.statusCode).toBe(401);
    },
  );
});
