import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultsFor, resolveMode } from "./mode.ts";

describe("resolveMode", () => {
  it("returns local when LORE_API_URL is unset", () => {
    assert.deepEqual(resolveMode({}), {
      kind: "local",
      apiUrl: "http://localhost:3001",
    });
  });

  it("returns local for http://localhost:3001", () => {
    assert.equal(
      resolveMode({ LORE_API_URL: "http://localhost:3001" }).kind,
      "local",
    );
  });

  it("returns local for http://127.0.0.1:3001", () => {
    assert.equal(
      resolveMode({ LORE_API_URL: "http://127.0.0.1:3001" }).kind,
      "local",
    );
  });

  it("returns local for an IPv6 loopback url", () => {
    assert.equal(
      resolveMode({ LORE_API_URL: "http://[::1]:3001" }).kind,
      "local",
    );
  });

  it("returns remote for a non-localhost LORE_API_URL", () => {
    assert.deepEqual(
      resolveMode({ LORE_API_URL: "https://lore-api.gcp.re-cinq.com" }),
      { kind: "remote", apiUrl: "https://lore-api.gcp.re-cinq.com" },
    );
  });

  it("drops the trailing slash of a remote LORE_API_URL", () => {
    assert.equal(
      resolveMode({ LORE_API_URL: "https://lore-api.example.com/" }).apiUrl,
      "https://lore-api.example.com",
    );
  });

  it("throws naming the value when LORE_API_URL is garbage", () => {
    assert.throws(
      () => resolveMode({ LORE_API_URL: "garbage" }),
      new Error('LORE_API_URL is not a valid URL: "garbage"'),
    );
  });
});

describe("defaultsFor", () => {
  it("returns the eight local keys for local mode", () => {
    assert.deepEqual(defaultsFor(resolveMode({})), {
      LORE_DB_HOST: "localhost",
      LORE_DB_PORT: "5432",
      LORE_DB_NAME: "lore",
      LORE_DB_USER: "postgres",
      LORE_DB_PASSWORD: "lore",
      LORE_API_URL: "http://localhost:3001",
      LORE_UI_URL: "http://localhost:3000",
      LORE_INGEST_TOKEN: "lore-local-dev-token",
    });
  });

  it("returns nothing for remote mode", () => {
    assert.deepEqual(
      defaultsFor(
        resolveMode({ LORE_API_URL: "https://lore-api.example.com" }),
      ),
      {},
    );
  });
});
