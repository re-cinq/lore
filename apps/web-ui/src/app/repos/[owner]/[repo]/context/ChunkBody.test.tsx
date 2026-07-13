// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ChunkBody from "./ChunkBody";
import styles from "./ChunkBody.module.css";
import readme from "../ReadmeBox.module.css";

const findBox = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("div")).find((d) =>
    d.className.includes(readme.readme),
  );

describe("ChunkBody", () => {
  it("rewrites a repo-relative markdown link to GitHub and opens it in a new tab", () => {
    const { container } = render(
      <ChunkBody
        content="See [the spec](specs/x/spec.md)."
        contentType="doc"
        filePath="docs/readme.md"
        repo="re-cinq/lore"
      />,
    );
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/re-cinq/lore/blob/main/specs/x/spec.md"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toEqual("_blank");
    expect(link?.getAttribute("rel")).toEqual("noopener noreferrer");
  });

  it("highlights a code chunk and shows a symbol/line header linking to the GitHub range", () => {
    const { container } = render(
      <ChunkBody
        content={"export function foo() {\n  return 1;\n}"}
        contentType="code"
        filePath="agent/src/foo.ts"
        repo="re-cinq/lore"
        metadata={{
          symbol_type: "function",
          symbol_name: "foo",
          start_line: 10,
          end_line: 42,
        }}
      />,
    );
    const code = container.querySelector("code.hljs");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("language-typescript");
    expect(container.textContent).toContain("function foo · L10–42");
    const gh = container.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/re-cinq/lore/blob/main/agent/src/foo.ts#L10-L42"]',
    );
    expect(gh?.getAttribute("target")).toEqual("_blank");
  });

  it("shows the section title and a plain blob link (no line range) for a doc chunk", () => {
    const { container } = render(
      <ChunkBody
        content="# Heading\n\nbody"
        contentType="doc"
        filePath="docs/a.md"
        repo="re-cinq/lore"
        metadata={{ section_title: "Architecture" }}
      />,
    );
    expect(container.textContent).toContain("Architecture");
    expect(
      container.querySelector(
        'a[href="https://github.com/re-cinq/lore/blob/main/docs/a.md"]',
      ),
    ).not.toBeNull();
  });

  it("omits the header and clamps the body in preview mode", () => {
    const { container } = render(
      <ChunkBody
        content="body text"
        contentType="doc"
        filePath="docs/a.md"
        repo="re-cinq/lore"
        metadata={{ section_title: "Architecture" }}
        preview
      />,
    );
    expect(container.textContent).not.toContain("View on GitHub");
    expect(findBox(container)?.className).toContain(styles.previewBox);
  });

  it("leaves a markdown link relative (no new tab) when the repo is unknown", () => {
    const { container } = render(
      <ChunkBody
        content="See [x](specs/x.md)."
        contentType="doc"
        filePath="docs/a.md"
        repo="unknown"
      />,
    );
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="specs/x.md"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBeNull();
  });
});
