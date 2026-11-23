import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PARALLEL,
  implementationLoopMaxParallel,
  isMaxParallel,
} from "./implementation-loop-max-parallel.js";

describe("implementationLoopMaxParallel", () => {
  it("returns 1 when implementation_loop.max_parallel is absent", () => {
    expect(implementationLoopMaxParallel({})).toBe(DEFAULT_MAX_PARALLEL);
    expect(implementationLoopMaxParallel(null)).toBe(1);
    expect(
      implementationLoopMaxParallel({ implementation_loop: { enabled: true } }),
    ).toBe(1);
  });

  it("returns 3 when implementation_loop.max_parallel is 3, also from a JSON string", () => {
    expect(
      implementationLoopMaxParallel({
        implementation_loop: { max_parallel: 3 },
      }),
    ).toBe(3);
    expect(
      implementationLoopMaxParallel(
        '{"implementation_loop":{"max_parallel":3}}',
      ),
    ).toBe(3);
  });

  it("returns 1 when max_parallel is 0, 6, 2.5 or the text 3", () => {
    for (const bad of [0, 6, 2.5, "3"]) {
      expect(
        implementationLoopMaxParallel({
          implementation_loop: { max_parallel: bad },
        }),
      ).toBe(1);
    }
  });
});

describe("isMaxParallel", () => {
  it("accepts the whole numbers 1 to 5 and refuses 0, 6, 2.5 and text", () => {
    expect([1, 2, 3, 4, 5].every(isMaxParallel)).toBe(true);
    expect([0, 6, 2.5, "3", null].some(isMaxParallel)).toBe(false);
  });
});
