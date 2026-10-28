import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import type { UserGrant } from "@re-cinq/lore-shared/models/login-handoff.js";
import {
  HANDOFF_TTL_MS,
  memoryLoginHandoffs,
  pgLoginHandoffs,
} from "./login-handoffs.js";

const grant: UserGrant = {
  login: "gedaiu",
  name: "Bogdan",
  avatarUrl: "https://avatars.example/1",
  scopes: ["read"],
  repos: ["re-cinq/lore"],
};

describe("memoryLoginHandoffs", () => {
  it("returns the row once and nothing the second time", async () => {
    const handoffs = memoryLoginHandoffs();
    const code = await handoffs.put("redeem", { returnUrl: "http://localhost:3000/x", grant });

    expect(await handoffs.take(code, "redeem")).toEqual({
      returnUrl: "http://localhost:3000/x",
      grant,
    });
    expect(await handoffs.take(code, "redeem")).toBeNull();
  });

  it("returns null for a code of the other phase", async () => {
    const handoffs = memoryLoginHandoffs();
    const code = await handoffs.put("state", { returnUrl: "http://localhost:3000/x", grant: null });

    expect(await handoffs.take(code, "redeem")).toBeNull();
  });

  it("returns null after expiry", async () => {
    let now = 1_000;
    const handoffs = memoryLoginHandoffs({ now: () => now });
    const code = await handoffs.put("state", { returnUrl: "http://localhost:3000/x", grant: null });

    now += HANDOFF_TTL_MS + 1;

    expect(await handoffs.take(code, "state")).toBeNull();
  });

  it("returns null for a code it never issued", async () => {
    expect(await memoryLoginHandoffs().take("nope", "state")).toBeNull();
  });
});

describe("pgLoginHandoffs", () => {
  it("takes a row with one DELETE that returns it", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ returnUrl: "http://localhost:3000/x", grant: null }],
    });
    const handoffs = pgLoginHandoffs(() => ({ query }) as unknown as Pool);

    expect(await handoffs.take("code-1", "state")).toEqual({
      returnUrl: "http://localhost:3000/x",
      grant: null,
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM lore\.login_handoffs[\s\S]*RETURNING/);
  });

  it("returns null when the DELETE matched nothing", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    expect(
      await pgLoginHandoffs(() => ({ query }) as unknown as Pool).take("code-1", "redeem"),
    ).toBeNull();
  });
});
