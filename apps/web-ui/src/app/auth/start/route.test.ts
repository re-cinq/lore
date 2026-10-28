// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { GET } from "./route";

const original = {
  public: process.env.LORE_API_PUBLIC_URL,
  api: process.env.LORE_API_URL,
};

const start = (query = "") =>
  GET(
    new Request(`http://pod:3000/auth/start${query}`, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "lore.example",
      },
    }),
  );

afterEach(() => {
  process.env.LORE_API_PUBLIC_URL = original.public;
  process.env.LORE_API_URL = original.api;
});

describe("GET /auth/start", () => {
  it("sends the person to lore-api's sign-in, told which page to come back to", async () => {
    process.env.LORE_API_PUBLIC_URL = "https://lore-api.example";
    const res = await start();

    expect(res.headers.get("location")).toBe(
      "https://lore-api.example/api/auth/login?return=https%3A%2F%2Flore.example%2Fauth%2Fcallback",
    );
  });

  it("asks lore-api to bring the person back to the page they asked for", async () => {
    process.env.LORE_API_PUBLIC_URL = "https://lore-api.example";
    const res = await start("?next=%2Fassembly-runs%2Frun-1");

    expect(res.headers.get("location")).toBe(
      "https://lore-api.example/api/auth/login?return=" +
        encodeURIComponent(
          "https://lore.example/auth/callback?next=%2Fassembly-runs%2Frun-1",
        ),
    );
  });

  it("ignores a page on another site", async () => {
    process.env.LORE_API_PUBLIC_URL = "https://lore-api.example";
    const res = await start("?next=https%3A%2F%2Fevil.example%2Fx");

    expect(res.headers.get("location")).toBe(
      "https://lore-api.example/api/auth/login?return=https%3A%2F%2Flore.example%2Fauth%2Fcallback",
    );
  });

  it("answers 500 while no lore-api address is configured", async () => {
    delete process.env.LORE_API_PUBLIC_URL;
    delete process.env.LORE_API_URL;
    const res = await start();

    expect(res.status).toBe(500);
  });
});
