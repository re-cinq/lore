import { describe, it, expect } from "vitest";
import { markdownDocument } from "./markdown.js";

describe("markdownDocument", () => {
  it("heads the document with its title, lists the fields in bold and ends at the message", () => {
    expect(
      markdownDocument(
        "Title",
        [
          ["Author", "gedaiu"],
          ["State", "open"],
        ],
        "Body.",
      ),
    ).toEqual("# Title\n\n- **Author:** gedaiu\n- **State:** open\n\nBody.");
  });

  it("ends at the field list when the message is empty", () => {
    expect(markdownDocument("Title", [["Author", "gedaiu"]], "")).toEqual(
      "# Title\n\n- **Author:** gedaiu",
    );
  });
});
