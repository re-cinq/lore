import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../outbound/plans/plan-store-pg.js";
import { collabAuthenticator, mintCollabToken } from "./collab-tokens.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const FUTURE = new Date("2026-11-22T10:10:00Z");
const PAST = new Date("2026-11-22T09:59:59Z");
const ANA = { id: "ana", name: "Ana" };
const SCOPE = { repo: "acme/collab", planId: "plan-1" };

function stubDb(rows: Array<Record<string, unknown>>): Db {
  const query = vi.fn().mockResolvedValue({ rows });

  return (() => ({ query })) as unknown as Db;
}

describe("collabAuthenticator session principal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("authenticates a token with its stored sessionId, falls back to the in-memory minting session when stored is null, and omits sessionId when minted without one", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const storedDb = stubDb([
      { id: "ana", name: "Ana", role: "write", sessionId: "s-stored" },
    ]);
    const memoryDb = stubDb([
      { id: "ana", name: "Ana", role: "write", sessionId: null },
    ]);
    const withSession = await mintCollabToken(
      memoryDb,
      { ...SCOPE, user: ANA, role: "write", sessionId: "s-minted" },
      FUTURE,
    );
    const withoutSession = await mintCollabToken(
      memoryDb,
      { ...SCOPE, user: ANA, role: "write" },
      FUTURE,
    );
    const withoutPrincipal = await collabAuthenticator(memoryDb).authenticate(
      withoutSession,
      SCOPE,
    );

    expect({
      fromStored: await collabAuthenticator(storedDb).authenticate(
        withoutSession,
        SCOPE,
      ),
      fromMemory: await collabAuthenticator(memoryDb).authenticate(
        withSession,
        SCOPE,
      ),
      withoutSession: withoutPrincipal,
      hasSessionKey:
        withoutPrincipal !== null && "sessionId" in withoutPrincipal,
    }).toEqual({
      fromStored: {
        id: "ana",
        name: "Ana",
        role: "write",
        sessionId: "s-stored",
      },
      fromMemory: {
        id: "ana",
        name: "Ana",
        role: "write",
        sessionId: "s-minted",
      },
      withoutSession: { id: "ana", name: "Ana", role: "write" },
      hasSessionKey: false,
    });
  });

  it("sweeps expired in-memory minting sessions when a new token is minted", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const db = stubDb([
      { id: "ana", name: "Ana", role: "write", sessionId: null },
    ]);
    const expired = await mintCollabToken(
      db,
      { ...SCOPE, user: ANA, role: "write", sessionId: "s-expired" },
      PAST,
    );

    await mintCollabToken(db, { ...SCOPE, user: ANA, role: "write" }, FUTURE);
    const principal = await collabAuthenticator(db).authenticate(
      expired,
      SCOPE,
    );

    expect({
      principal,
      hasSessionKey: principal !== null && "sessionId" in principal,
    }).toEqual({
      principal: { id: "ana", name: "Ana", role: "write" },
      hasSessionKey: false,
    });
  });
});
