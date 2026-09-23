import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  liveTokenVerifier,
  mintLiveToken,
} from "../work/assembly-line-station/live-tokens.js";

const ANA = { id: "ana", name: "Ana" };
const EXPIRED = new Date("2026-01-01T00:00:00Z");
const RUN = "11111111-1111-1111-1111-111111111111";

describe("live tokens", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM lore.live_tokens WHERE user_id = $1", [
      ANA.id,
    ]);
    await pool.end();
  });

  it("opens the run it was minted for as Ana", async () => {
    const { token } = await mintLiveToken(() => pool, {
      kind: "run",
      subject: RUN,
      user: ANA,
    });

    expect(
      await liveTokenVerifier(() => pool)(token, { kind: "run", subject: RUN }),
    ).toEqual(ANA);
  });

  it("opens no other run than the one it was minted for", async () => {
    const { token } = await mintLiveToken(() => pool, {
      kind: "run",
      subject: RUN,
      user: ANA,
    });

    expect(
      await liveTokenVerifier(() => pool)(token, {
        kind: "run",
        subject: "22222222-2222-2222-2222-222222222222",
      }),
    ).toBeNull();
  });

  it("opens nothing once it has expired, and a later mint sweeps it", async () => {
    const { token } = await mintLiveToken(
      () => pool,
      { kind: "run", subject: RUN, user: ANA },
      EXPIRED,
    );

    expect(
      await liveTokenVerifier(() => pool)(token, { kind: "run", subject: RUN }),
    ).toBeNull();
    await mintLiveToken(() => pool, { kind: "run", subject: RUN, user: ANA });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM lore.live_tokens WHERE expires_at < now()",
    );

    expect(rows[0]).toEqual({ n: 0 });
  });
});
