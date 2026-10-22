import { describe, it, expect } from "vitest";
import { linkedIssueNumber, loreTaskIdOf, prFooter } from "./pr-body.js";

describe("prFooter (T047)", () => {
  it("emits Lore-Task only when no issue exists", () => {
    expect(prFooter({ issueNumber: null, taskId: "uuid-1" })).toBe(
      "\n\nLore-Task: uuid-1",
    );
  });

  it("emits Closes #N + Lore-Task when issue exists", () => {
    expect(prFooter({ issueNumber: 42, taskId: "uuid-1" })).toBe(
      "\n\nCloses #42\nLore-Task: uuid-1",
    );
  });

  it("treats undefined issueNumber as no issue", () => {
    expect(prFooter({ taskId: "uuid-1" })).toBe("\n\nLore-Task: uuid-1");
  });

  it("treats issueNumber:0 as no issue (truthiness)", () => {
    expect(prFooter({ issueNumber: 0, taskId: "uuid-1" })).toBe(
      "\n\nLore-Task: uuid-1",
    );
  });

  it("emits Refs #N + Lore-Task on partial coverage", () => {
    expect(
      prFooter({ issueNumber: 42, taskId: "uuid-1", coverage: "partial" }),
    ).toBe("\n\nRefs #42\nLore-Task: uuid-1");
  });

  it("emits Closes #N on explicit full coverage", () => {
    expect(
      prFooter({ issueNumber: 42, taskId: "uuid-1", coverage: "full" }),
    ).toBe("\n\nCloses #42\nLore-Task: uuid-1");
  });

  it("emits Lore-Task only on partial coverage without an issue", () => {
    expect(prFooter({ taskId: "uuid-1", coverage: "partial" })).toBe(
      "\n\nLore-Task: uuid-1",
    );
  });
});

describe("linkedIssueNumber", () => {
  it("returns 12 for Closes #12", () => {
    expect(linkedIssueNumber("Closes #12")).toBe(12);
  });

  it("returns null for Refs #7, which relates to an issue without claiming to resolve it", () => {
    expect(
      linkedIssueNumber("Adds the route.\n\nRefs #7\nLore-Task: uuid-1"),
    ).toBeNull();
  });

  it("returns 5 when Closes #5 comes before Fixes #8", () => {
    expect(linkedIssueNumber("Closes #5 and Fixes #8")).toBe(5);
  });

  it("returns 3 for lowercase fixes #3", () => {
    expect(linkedIssueNumber("fixes #3")).toBe(3);
  });

  it("returns null for see #9 without a keyword", () => {
    expect(linkedIssueNumber("see #9")).toBeNull();
  });

  it("returns null for a null body", () => {
    expect(linkedIssueNumber(null)).toBeNull();
  });
});

describe("loreTaskIdOf", () => {
  it("returns 6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c from the footer prFooter writes", () => {
    const body = `Adds the station.${prFooter({ issueNumber: 12, taskId: "6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c" })}`;

    expect(loreTaskIdOf(body)).toBe("6f1c2e9a-0b1d-4c3e-9f2a-7d8e9f0a1b2c");
  });

  it("returns null for a body with no Lore-Task line", () => {
    expect(loreTaskIdOf("Closes #12")).toBe(null);
  });

  it("returns null for an undefined body", () => {
    expect(loreTaskIdOf(undefined)).toBe(null);
  });
});
