import { describe, expect, it } from "vitest";
import { packSyncTick } from "./pack-sync-tick.js";

describe("packSyncTick", () => {
  it("asks lore-api to sync once and answers the line it read", async () => {
    let asked = 0;

    const summary = await packSyncTick(async () => {
      asked += 1;

      return {
        status: 200,
        body: '{"status":"applied","commit":"a1b2c3d","changed":["triager"]}',
      };
    });

    expect({ asked, summary }).toEqual({
      asked: 1,
      summary: "pack a1b2c3d applied: triager",
    });
  });

  it("answers a dropped socket as the line, since the next tick asks again", async () => {
    expect(
      await packSyncTick(async () => {
        throw new Error("socket hang up");
      }),
    ).toBe("socket hang up");
  });
});
