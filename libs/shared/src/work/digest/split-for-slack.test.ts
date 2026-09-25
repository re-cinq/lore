import { describe, it, expect } from "vitest";
import { splitForSlack } from "./split-for-slack.js";

describe("splitForSlack", () => {
  it("returns one chunk when the text fits", () => {
    expect(splitForSlack("a\nb\nc", 10)).toEqual(["a\nb\nc"]);
  });

  it("breaks only at a line end when the next line would exceed the limit", () => {
    expect(splitForSlack("aaaa\nbbbb\ncccc", 9)).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("keeps every line whole", () => {
    const chunks = splitForSlack("12345\n67890\nabcde", 11);

    expect(chunks).toEqual(["12345\n67890", "abcde"]);
  });

  it("hard-cuts a single line longer than the limit", () => {
    expect(splitForSlack("abcdefghij", 5)).toEqual(["abcd…"]);
  });

  it("drops blank leading and trailing lines from every chunk", () => {
    expect(splitForSlack("a\n\n\nb", 3)).toEqual(["a", "b"]);
  });
});
