import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setEmbedForTests } from "./embed.js";

const originalEnv = { ...process.env };

const post = (body: unknown) =>
  buildServer(() => makePool() as any).inject({
    method: "POST",
    url: "/api/embed",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/embed", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    setEmbedForTests(async (text) => (text === "hello" ? [0.1, 0.2] : null));
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setEmbedForTests(undefined);
    vi.clearAllMocks();
  });

  it("returns the embedding for the posted text", async () => {
    const res = await post({ text: "hello" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ embedding: [0.1, 0.2] });
  });

  it("returns a null embedding when the provider yields none", async () => {
    const res = await post({ text: "unembeddable" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ embedding: null });
  });

  it("rejects a missing text with 400", async () => {
    expect((await post({})).statusCode).toBe(400);
  });
});
