import { describe, it, expect } from "vitest";
import * as sharedIndex from "./index.js";

describe("shared/src/index", () => {
  it("FR6.51: subject_key formatting functions are exported for API query construction", () => {
    expect(sharedIndex).toMatchObject({
      planSubject: expect.any(Function),
      detectSubject: expect.any(Function),
      reviewSubject: expect.any(Function),
      ingestSubject: expect.any(Function),
    });
  });
});
