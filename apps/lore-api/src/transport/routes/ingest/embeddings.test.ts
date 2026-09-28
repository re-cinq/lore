import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { setEmbeddingsForTests } from "./embeddings.js";

const originalEnv = { ...process.env };

const post = (body: unknown) =>
  buildServer(() => makePool() as never).inject({
    method: "POST",
    url: "/api/embeddings",
    headers: AUTH,
    payload: JSON.stringify(body),
  });

describe("POST /api/embeddings", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    setEmbeddingsForTests(async (texts) =>
      texts.map((text) => (text === "unembeddable" ? null : [text.length])),
    );
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    setEmbeddingsForTests(undefined);
  });

  it("returns one embedding per posted text, in order", async () => {
    const res = await post({ texts: ["a", "bb", "ccc"] });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ embeddings: [[1], [2], [3]] });
  });

  it("returns null in the place of a text the provider could not embed", async () => {
    const res = await post({ texts: ["a", "unembeddable"] });

    expect(JSON.parse(res.payload)).toEqual({ embeddings: [[1], null] });
  });

  it("rejects 251 texts with 400", async () => {
    const texts = Array.from({ length: 251 }, () => "a");

    expect((await post({ texts })).statusCode).toBe(400);
  });

  it("rejects an empty text list with 400", async () => {
    expect((await post({ texts: [] })).statusCode).toBe(400);
  });
});
