import { describe, it, expect } from "vitest";
import { diffViewModel, matchChangedFile } from "./pull-file-diff";
import type { PullFileChange } from "@/lib/api/pull-files";

const change = (
  filename: string,
  patch: string | null = "",
): PullFileChange => ({
  filename,
  status: "modified",
  additions: 0,
  deletions: 0,
  patch,
});

describe("matchChangedFile", () => {
  it("matches the exact filename first", () => {
    const files = [change("src/a.ts"), change("packages/src/a.ts")];

    expect(matchChangedFile(files, "src/a.ts")).toBe(files[0]);
  });

  it("matches after dropping the /workspace/ prefix", () => {
    const files = [change("src/a.ts")];

    expect(matchChangedFile(files, "/workspace/src/a.ts")).toBe(files[0]);
  });

  it("matches a shared tail in either direction", () => {
    const files = [change("apps/web-ui/src/a.ts"), change("src/b.ts")];

    expect(matchChangedFile(files, "/repo/checkout/src/b.ts")).toBe(files[1]);
    expect(matchChangedFile(files, "src/a.ts")).toBe(files[0]);
  });

  it("returns null when no changed file resembles the path", () => {
    expect(matchChangedFile([change("src/a.ts")], "src/z.ts")).toBeNull();
  });
});

describe("diffViewModel", () => {
  it("is absent for a null file", () => {
    expect(diffViewModel(null)).toEqual({ kind: "absent" });
  });

  it("is binary when GitHub gave no patch", () => {
    const file = change("logo.png", null);

    expect(diffViewModel(file)).toEqual({ kind: "binary", file });
  });

  it("parses the patch into numbered lines with their tally", () => {
    const file = change("src/a.ts", "@@ -1,2 +1,2 @@\n-old\n+new\n ctx");

    expect(diffViewModel(file)).toEqual({
      kind: "diff",
      file,
      lines: [
        { kind: "hunk", oldNo: null, newNo: null, text: "@@ -1,2 +1,2 @@" },
        { kind: "del", oldNo: 1, newNo: null, text: "old" },
        { kind: "add", oldNo: null, newNo: 1, text: "new" },
        { kind: "ctx", oldNo: 2, newNo: 2, text: "ctx" },
      ],
      stats: { added: 1, removed: 1 },
    });
  });
});
