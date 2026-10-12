import { describe, expect, it } from "vitest";
import { dodPathOf } from "./loop-config.js";

describe("dodPathOf", () => {
  it("answers .lore/dod.md when the repository has no .lore/loop.yml", () => {
    expect(dodPathOf(null)).toBe(".lore/dod.md");
  });

  it("answers .lore/dod.md when .lore/loop.yml names no dod_path", () => {
    expect(dodPathOf("other: value\n")).toBe(".lore/dod.md");
  });

  it("answers .lore/dod.md when .lore/loop.yml is empty", () => {
    expect(dodPathOf("")).toBe(".lore/dod.md");
  });

  it("answers solutions/widgets/.lore/dod.md when .lore/loop.yml names it", () => {
    expect(dodPathOf("dod_path: solutions/widgets/.lore/dod.md\n")).toBe(
      "solutions/widgets/.lore/dod.md",
    );
  });

  it("refuses a dod_path of /etc/dod.md, which is absolute", () => {
    expect(() => dodPathOf("dod_path: /etc/dod.md\n")).toThrow(
      new Error(
        '.lore/loop.yml: dod_path must be a relative path to a .md file inside the repository, not "/etc/dod.md"',
      ),
    );
  });

  it("refuses a dod_path of ../dod.md, which leaves the repository", () => {
    expect(() => dodPathOf("dod_path: ../dod.md\n")).toThrow(
      new Error(
        '.lore/loop.yml: dod_path must be a relative path to a .md file inside the repository, not "../dod.md"',
      ),
    );
  });

  it("refuses a dod_path of notes/dod.txt, which is not markdown", () => {
    expect(() => dodPathOf("dod_path: notes/dod.txt\n")).toThrow(
      new Error(
        '.lore/loop.yml: dod_path must be a relative path to a .md file inside the repository, not "notes/dod.txt"',
      ),
    );
  });
});
