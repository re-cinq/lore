import { describe, expect, it } from "vitest";
import { carriedApprovalCheck, sameNetChange } from "./carry-approval.js";

const ADD_LOGIN = {
  filename: "src/login.ts",
  status: "modified",
  patch:
    "@@ -10,3 +10,4 @@ export function login() {\n   check();\n+  audit();\n   return ok;",
};

describe("sameNetChange", () => {
  it("is true for the same files and lines whose hunks moved because main grew above them, since a rebase alone moves them", () => {
    const moved = {
      ...ADD_LOGIN,
      patch: ADD_LOGIN.patch.replace("@@ -10,3 +10,4 @@", "@@ -14,3 +14,4 @@"),
    };

    expect(sameNetChange([ADD_LOGIN], [moved])).toBe(true);
  });

  it("is false when a line, a file or a file's status differs, and for a change GitHub could not compare", () => {
    expect([
      sameNetChange(
        [ADD_LOGIN],
        [{ ...ADD_LOGIN, patch: `${ADD_LOGIN.patch}\n+  log();` }],
      ),
      sameNetChange(
        [ADD_LOGIN],
        [ADD_LOGIN, { filename: "src/b.ts", status: "added", patch: "+x" }],
      ),
      sameNetChange([ADD_LOGIN], [{ ...ADD_LOGIN, status: "renamed" }]),
      sameNetChange(null, [ADD_LOGIN]),
      sameNetChange([], []),
    ]).toEqual([false, false, false, false, false]);
  });

  it("is false when GitHub leaves a file's patch out, since a binary or very large file cannot be compared line by line", () => {
    const unread = { filename: "logo.png", status: "modified" };

    expect(sameNetChange([unread], [unread])).toBe(false);
  });
});

describe("carriedApprovalCheck", () => {
  it("publishes lore/code-review as success on sha-new, naming sha-old whose approval it carries", () => {
    expect(carriedApprovalCheck("sha-new", "sha-old0123456")).toEqual({
      headSha: "sha-new",
      name: "lore/code-review",
      status: "completed",
      conclusion: "success",
      title: "Approved: the rebase changed nothing Lore reviewed",
      summary:
        "Lore approved sha-old and this push is a rebase of the same change: every file and line the pull request changes is as it was, so the approval carries over without a re-check.",
    });
  });
});
