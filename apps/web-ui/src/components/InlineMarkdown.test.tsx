// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import InlineMarkdown from "./InlineMarkdown";

describe("InlineMarkdown", () => {
  it("renders bold as a strong element", () => {
    const { container } = render(<InlineMarkdown text="a **bold** word" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.textContent).toBe("a bold word");
  });

  it("renders italics as an em element", () => {
    const { container } = render(<InlineMarkdown text="an *italic* word" />);
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("renders inline code as a code element", () => {
    const { container } = render(<InlineMarkdown text="run `npm test` now" />);
    expect(container.querySelector("code")?.textContent).toBe("npm test");
  });

  it("renders plain prose without wrapping it in a block paragraph", () => {
    const { container } = render(<InlineMarkdown text="just text" />);
    expect(container.textContent).toBe("just text");
    expect(container.querySelector("p")).toBeNull();
  });
});
