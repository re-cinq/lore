import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { ttlMemo } from "./ttl-memo.js";

describe("ttlMemo", () => {
  it("asks once within the window and again after it", async () => {
    let clock = 0;
    const asked: string[] = [];
    const lookup = ttlMemo(
      async (key) => {
        asked.push(key);

        return null;
      },
      1000,
      () => clock,
    );

    await lookup("gedaiu");
    await lookup("gedaiu");
    clock = 1001;
    await lookup("gedaiu");

    expect(asked).toEqual(["gedaiu", "gedaiu"]);
  });

  it("forgets a failed lookup so the next call asks again", async () => {
    let calls = 0;
    const lookup = ttlMemo(async () => {
      calls += 1;

      enforceTrue(calls !== 1, Error, "missing_scope");

      return "Bogdan";
    }, 1000);

    await expect(lookup("U1")).rejects.toThrow(new Error("missing_scope"));
    expect(await lookup("U1")).toBe("Bogdan");
  });
});
