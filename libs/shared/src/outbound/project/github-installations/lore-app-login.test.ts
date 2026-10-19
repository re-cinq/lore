import { describe, it, expect } from "vitest";
import { appLoginReader } from "./lore-app-login.js";

describe("appLoginReader", () => {
  it("answers the slug with the bot suffix and asks GitHub once for two reads", async () => {
    const asked: string[] = [];
    const login = appLoginReader(async () => {
      asked.push("GET /app");

      return "lore-app";
    });

    expect([await login(), await login(), asked]).toEqual([
      "lore-app[bot]",
      "lore-app[bot]",
      ["GET /app"],
    ]);
  });

  it("asks GitHub again after a failed read instead of keeping the failure", async () => {
    const answers = [
      () => Promise.reject(new Error("GitHub 502")),
      () => Promise.resolve("lore-app"),
    ];
    const login = appLoginReader(() => answers.shift()!());

    await expect(login()).rejects.toThrow(new Error("GitHub 502"));
    expect(await login()).toBe("lore-app[bot]");
  });
});
