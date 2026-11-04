import { describe, expect, it } from "vitest";
import { previousWorkLines } from "./previous-work.js";

describe("previousWorkLines", () => {
  it("lists memory session-summary/2026-09-28 once when the search found it twice", () => {
    const memory = {
      key: "session-summary/2026-09-28",
      value: "Batched embeddings shipped",
    };

    expect(previousWorkLines([memory, memory])).toEqual([
      "memory session-summary/2026-09-28: Batched embeddings shipped",
    ]);
  });

  it("cuts a 2000-character memory to 600 characters", () => {
    const [line] = previousWorkLines([{ key: "k", value: "x".repeat(2000) }]);

    expect(line).toHaveLength("memory k: ".length + 600);
  });
});
