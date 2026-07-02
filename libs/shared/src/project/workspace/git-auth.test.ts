import { describe, it, expect } from "vitest";
import { gitAuthArgs, repoCloneUrl } from "./git-auth.js";

describe("gitAuthArgs", () => {
  it("carries the token as an http.extraheader config override, base64 x-access-token", () => {
    const b64 = Buffer.from("x-access-token:tok123").toString("base64");
    expect(gitAuthArgs("tok123")).toEqual([
      "-c",
      `http.https://github.com/.extraheader=Authorization: Basic ${b64}`,
    ]);
  });

  it("honours a non-default host", () => {
    expect(gitAuthArgs("t", "ghe.example.com")[1]).toContain("http.https://ghe.example.com/.extraheader=");
  });

  it("never embeds the raw token in the args (only the base64 header)", () => {
    expect(gitAuthArgs("secret-token").join(" ")).not.toContain("secret-token");
  });
});

describe("repoCloneUrl", () => {
  it("builds a credential-free https url with no token or @", () => {
    const url = repoCloneUrl("re-cinq/lore");
    expect(url).toBe("https://github.com/re-cinq/lore.git");
    expect(url).not.toContain("@");
    expect(url).not.toContain("x-access-token");
  });
});
