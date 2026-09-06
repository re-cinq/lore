import { describe, it, expect } from "vitest";
import { prFooter } from "./pr-body.js";

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
