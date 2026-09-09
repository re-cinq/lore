import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[][] = [];

vi.mock("node:child_process", () => ({
  execFileSync: (_cmd: string, args: string[]) => {
    calls.push(args);

    return "";
  },
}));

import { GitCli } from "./git-cli.js";

beforeEach(() => {
  calls.length = 0;
});

describe("GitCli auth (token off disk)", () => {
  it("clone carries the token in http.extraheader, never in the URL or .git/config", async () => {
    await new GitCli({ GITHUB_TOKEN: "ghs_secret" }).clone(
      "re-cinq/lore",
      "/tmp/dest",
    );
    const argv = calls[0].join(" ");

    expect(argv).toContain("http.https://github.com/.extraheader=");
    expect(calls[0]).toContain("https://github.com/re-cinq/lore.git");
    expect(argv).not.toContain("x-access-token:ghs_secret");
    expect(argv).not.toContain("ghs_secret@");
  });

  it("push forwards the same auth args", async () => {
    await new GitCli({ GITHUB_TOKEN: "ghs_secret" }).push(
      "/tmp/dest",
      "lore/x",
    );
    expect(calls[0].join(" ")).toContain(
      "http.https://github.com/.extraheader=",
    );
    expect(calls[0].slice(-3)).toEqual(["push", "origin", "lore/x"]);
  });

  it("no token → no auth args and a credential-free URL", async () => {
    await new GitCli({}).clone("re-cinq/lore", "/tmp/dest");
    expect(calls[0].some((a) => a.includes("extraheader"))).toBe(false);
    expect(calls[0]).toContain("https://github.com/re-cinq/lore.git");
  });
});
