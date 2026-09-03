// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ReadmeBox from "./ReadmeBox";

const rawBaseUrl = "https://raw.githubusercontent.com/re-cinq/lore/main/";
const htmlUrl = "https://github.com/re-cinq/lore/blob/main/";

const threeBlocks =
  "# Heading\n\nFirst paragraph body.\n\nSecond paragraph body.";
const twoBlocks = "# Heading\n\nOnly one paragraph.";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReadmeBox", () => {
  it("renders the markdown heading as an h1 element", () => {
    const { container } = render(
      <ReadmeBox
        markdown={twoBlocks}
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );

    expect(container.querySelector("h1")?.textContent).toBe("Heading");
  });

  it("renders all blocks and no expand button when content is not collapsible", () => {
    render(
      <ReadmeBox
        markdown={twoBlocks}
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );
    expect(screen.getByText("Only one paragraph.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a single block as full markdown without a button", () => {
    render(
      <ReadmeBox
        markdown="just one block"
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );
    expect(screen.getByText("just one block")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a Read more button and hides later blocks when collapsible and collapsed", () => {
    render(
      <ReadmeBox
        markdown={threeBlocks}
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );

    expect(screen.getByText("First paragraph body.")).toBeInTheDocument();
    expect(
      screen.queryByText("Second paragraph body."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Read more" }),
    ).toBeInTheDocument();
  });

  it("reveals the hidden block and swaps the label to Read less after clicking Read more", () => {
    render(
      <ReadmeBox
        markdown={threeBlocks}
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));

    expect(screen.getByText("Second paragraph body.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Read less" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Read more" }),
    ).not.toBeInTheDocument();
  });

  it("collapses again and restores Read more after a second click toggles expanded off", () => {
    render(
      <ReadmeBox
        markdown={threeBlocks}
        rawBaseUrl={rawBaseUrl}
        htmlUrl={htmlUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Read more" }));
    expect(screen.getByText("Second paragraph body.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read less" }));

    expect(
      screen.queryByText("Second paragraph body."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Read more" }),
    ).toBeInTheDocument();
  });

  it("resolves a relative image src against rawBaseUrl via the src branch of urlTransform", () => {
    const md = "![logo](docs/logo.png)";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const img = container.querySelector("img");

    expect(img?.getAttribute("src")).toBe(
      "https://raw.githubusercontent.com/re-cinq/lore/main/docs/logo.png",
    );
  });

  it("resolves a relative link href against htmlUrl via the non-src branch of urlTransform", () => {
    const md = "[contributing](docs/CONTRIBUTING.md)";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const link = container.querySelector("a");

    expect(link?.getAttribute("href")).toBe(
      "https://github.com/re-cinq/lore/blob/main/docs/CONTRIBUTING.md",
    );
    expect(link?.textContent).toBe("contributing");
  });

  it("leaves an absolute https link href untouched through urlTransform", () => {
    const md = "[home](https://example.com/page)";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/page",
    );
  });

  it("renders a remark-gfm table from pipe syntax", () => {
    const md = "| A | B |\n| - | - |\n| 1 | 2 |";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const table = container.querySelector("table");

    expect(table).not.toBeNull();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("td")?.textContent).toBe("1");
  });

  it("renders raw inline HTML through the rehype-raw plugin", () => {
    const md = "before <mark>highlighted</mark> after";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("mark")?.textContent).toBe("highlighted");
  });

  it("renders a fenced code block as a pre/code element", () => {
    const md = "```\nnpm test\n```";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("pre code")?.textContent).toContain(
      "npm test",
    );
  });

  it("strips an injected script element instead of rendering it", () => {
    const md = "before <script>window.hacked = true;</script> after";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("window.hacked");
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("removes an onerror handler from raw img HTML but keeps the image", () => {
    const md =
      '<img src="docs/logo.png" alt="logo" onerror="window.hacked = true" />';
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const img = container.querySelector("img");

    expect(img).not.toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
    expect(img?.getAttribute("alt")).toBe("logo");
  });

  it("strips a javascript: href from a markdown link but keeps the label", () => {
    const md = "[click me](javascript:alert(1))";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const link = container.querySelector("a");

    expect(link?.textContent).toBe("click me");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
  });

  it("strips a javascript: href from a raw HTML anchor", () => {
    const md = '<a href="javascript:alert(1)">raw link</a>';
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const link = container.querySelector("a");

    expect(link?.textContent).toBe("raw link");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
  });

  it("drops an injected iframe element entirely", () => {
    const md = '<iframe src="https://evil.example/"></iframe>';
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders a GFM task-list checkbox through the sanitizer", () => {
    const md = "- [x] done item\n- [ ] open item";
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');

    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it("renders nothing visible for empty markdown and shows no button", () => {
    const { container } = render(
      <ReadmeBox markdown="" rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("drops an injected svg element carrying an onload handler", () => {
    const md = '<svg onload="window.hacked = true"><circle r="9" /></svg>';
    const { container } = render(
      <ReadmeBox markdown={md} rawBaseUrl={rawBaseUrl} htmlUrl={htmlUrl} />,
    );

    expect(container.querySelector("svg")).toBeNull();
  });
});
