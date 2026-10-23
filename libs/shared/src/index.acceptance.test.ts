import { describe, it, expect } from "vitest";
import * as sharedIndex from "./index.js";

describe("shared/src/index", () => {
  it("FR6.51: subject_key formatting functions are exported for API query construction", () => {
    expect(sharedIndex).toHaveProperty("planSubject");
    expect(sharedIndex).toHaveProperty("detectSubject");
    expect(sharedIndex).toHaveProperty("reviewSubject");
    expect(sharedIndex).toHaveProperty("ingestSubject");
  });
});
