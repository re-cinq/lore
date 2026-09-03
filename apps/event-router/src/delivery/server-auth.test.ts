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

      expect(res.statusCode).toBe(401);
    },
  );
});
