// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecDetails, { resolveHref, type StatementInfo } from "./SpecDetails";

const REPO = "re-cinq/lore";
const gh = (path: string) => `https://github.com/${REPO}/blob/main/${path}`;

const stmt = (overrides: Partial<StatementInfo> = {}): StatementInfo => ({
  ordinal: 0,
  text: "Default text.",
  kind: "sentence",
  state: "untested",
  category: null,
  testLinks: [],
  ...overrides,
});

const renderSpec = (
  content: string,
  statements: StatementInfo[],
  repo = REPO,
) =>
  render(<SpecDetails repo={repo} content={content} statements={statements} />);

describe("SpecDetails v3 (markdown-driven)", () => {
  it("wraps a statement that carries a test link in the trailing paren with stmt-tested", () => {
    const md =
      "## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);
    const mark = container.querySelector('mark[data-state="tested"]');

    expect(mark).not.toBeNull();
    expect(mark?.className).toContain("stmt-tested");
  });

  it("marks a drifted statement with data-drifted true on its mark", () => {
    const md =
      "## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
        drifted: true,
      }),
    ];
    const { container } = renderSpec(md, statements);

    expect(container.querySelector('mark[data-drifted="true"]')).not.toBeNull();
  });

  it("adds the stmt-drifted class to a drifted statement mark", () => {
    const md =
      "## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
        drifted: true,
      }),
    ];
    const { container } = renderSpec(md, statements);
    const mark = container.querySelector('mark[data-drifted="true"]');

    expect(mark?.className).toContain("stmt-drifted");
  });

  it("wraps an unlinked testable statement with stmt-untested (red)", () => {
    const md = "## Acceptance Criteria\n\n- Re-queues a stale task.\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Re-queues a stale task.",
        kind: "list-item",
        state: "untested",
      }),
    ];
    const { container } = renderSpec(md, statements);
    const mark = container.querySelector('mark[data-state="untested"]');

    expect(mark?.className).toContain("stmt-untested");
  });

  it("wraps a narrative-section statement with stmt-narrative (grey)", () => {
    const md = "## Limitations\n\n- Cannot be enforced.\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Cannot be enforced.",
        kind: "list-item",
        state: "narrative",
        category: "limitation",
      }),
    ];
    const { container } = renderSpec(md, statements);

    expect(
      container.querySelector('mark[data-state="narrative"]'),
    ).not.toBeNull();
  });

  it("renders an inline test link as an absolute GitHub URL opening in a new tab", () => {
    const md =
      "## A\n\n- Redacts secrets. ([validated by `redact.test.ts:7`](agent/src/lib/redact.test.ts#L7))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Redacts secrets. ([validated by `redact.test.ts:7`](agent/src/lib/redact.test.ts#L7))",
        kind: "list-item",
        state: "tested",
        testLinks: [
          {
            label: "validated by redact.test.ts:7",
            path: "agent/src/lib/redact.test.ts",
            line: 7,
          },
        ],
      }),
    ];
    const { container } = renderSpec(md, statements);
    const link = container.querySelector<HTMLAnchorElement>(
      `a[href="${gh("agent/src/lib/redact.test.ts#L7")}"]`,
    );

    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toEqual("_blank");
    expect(link?.getAttribute("rel")).toEqual("noopener noreferrer");
    expect(link?.querySelector("code")?.textContent).toEqual(
      "redact.test.ts:7",
    );
  });

  it("rewrites a non-test author link (ADR) to GitHub without the test-link cue", () => {
    const md =
      "## A\n\nPer [ADR-015](adrs/ADR-015.md). ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Per [ADR-015](adrs/ADR-015.md). ([t](src/x.test.ts#L1))",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);
    const adrLink = container.querySelector(
      `a[href="${gh("adrs/ADR-015.md")}"]`,
    );

    expect(adrLink?.className ?? "").not.toContain("stmt-test-link");
    expect(adrLink?.getAttribute("target")).toEqual("_blank");
    expect(
      container.querySelector(`a[href="${gh("src/x.test.ts#L1")}"]`),
    ).not.toBeNull();
  });

  it("leaves links relative (no new tab) when the repo is not owner/name", () => {
    const md = "## A\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements, "unknown");
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="src/x.test.ts#L1"]',
    );

    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBeNull();
  });

  it("points the hover popover test link at GitHub and opens it in a new tab", () => {
    const md =
      "## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);

    fireEvent.mouseOver(container.querySelector('mark[data-ordinal="0"]')!);
    const link = screen.getByRole("tooltip").querySelector("a");

    expect(link?.getAttribute("href")).toEqual(gh("src/x.test.ts#L1"));
    expect(link?.getAttribute("target")).toEqual("_blank");
    expect(link?.getAttribute("rel")).toEqual("noopener noreferrer");
  });

  it("surfaces a drift notice in the popover for a drifted statement", () => {
    const md =
      "## Acceptance Criteria\n\n- Claims a pending task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
        drifted: true,
      }),
    ];
    const { container } = renderSpec(md, statements);

    fireEvent.mouseOver(container.querySelector('mark[data-ordinal="0"]')!);
    expect(screen.getByRole("tooltip").textContent).toMatch(/drift/i);
  });

  it("does NOT render the legacy tests[] list, the legacy TestLink prop, or list-only/legacy badges", () => {
    const md = "## A\n\n- Plain.\n";
    const statements = [
      stmt({ ordinal: 0, text: "Plain.", state: "untested" }),
    ];

    renderSpec(md, statements);
    expect(screen.queryByText(/Tests validating this spec/)).toBeNull();
    expect(screen.queryByText(/list-only/)).toBeNull();
    expect(screen.queryByText(/legacy/)).toBeNull();
  });

  it("wraps a statement that spans inline bold formatting with stmt-tested", () => {
    const md =
      "## A\n\n- It claims a **pending** task. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "It claims a **pending** task. ([t](src/x.test.ts#L1))",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);
    const mark = container.querySelector('mark[data-state="tested"]');

    expect(mark?.className).toContain("stmt-tested");
    expect(
      container.querySelector(`a[href="${gh("src/x.test.ts#L1")}"]`),
    ).not.toBeNull();
  });

  it("wraps a statement containing inline code (backticks) with stmt-tested", () => {
    const md =
      "## Acceptance Criteria\n\n- A statement carrying a test link counts as `covered` in the `CoverageBar`. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "A statement carrying a test link counts as `covered` in the `CoverageBar`. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);
    const mark = container.querySelector('mark[data-state="tested"]');

    expect(mark?.className).toContain("stmt-tested");
    expect(mark?.getAttribute("data-ordinal")).toEqual("0");
    expect(container.querySelector("code")?.textContent).toEqual("covered");
  });

  it("keeps the highlight on re-render (matcher state is not stale across transforms)", () => {
    const md =
      "## Acceptance Criteria\n\n- A statement carrying a test link counts as `covered`. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "A statement carrying a test link counts as `covered`. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container, rerender } = render(
      <SpecDetails repo={REPO} content={md} statements={statements} />,
    );

    expect(container.querySelector('mark[data-state="tested"]')).not.toBeNull();
    rerender(<SpecDetails repo={REPO} content={md} statements={statements} />);
    expect(container.querySelector('mark[data-state="tested"]')).not.toBeNull();
  });

  it("wraps a code-span statement whose backticks contain literal link/emphasis syntax", () => {
    const md =
      "## Acceptance Criteria\n\n- The cron emits a `([validated by ...](path#Lline))` parenthetical. ([t](src/x.test.ts#L1))\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "The cron emits a `([validated by ...](path#Lline))` parenthetical. ([t](src/x.test.ts#L1))",
        kind: "list-item",
        state: "tested",
        testLinks: [{ label: "t", path: "src/x.test.ts", line: 1 }],
      }),
    ];
    const { container } = renderSpec(md, statements);

    expect(
      container.querySelector('mark[data-state="tested"]')?.className,
    ).toContain("stmt-tested");
  });
});

describe("resolveHref", () => {
  it("rewrites a repo-relative path to a GitHub blob URL marked external", () => {
    expect(
      resolveHref("agent/src/x.test.ts#L7", "re-cinq/lore", "main"),
    ).toEqual({
      href: "https://github.com/re-cinq/lore/blob/main/agent/src/x.test.ts#L7",
      external: true,
    });
  });

  it("strips a leading ./ before building the GitHub URL", () => {
    expect(resolveHref("./adrs/ADR-1.md", "re-cinq/lore", "main").href).toEqual(
      "https://github.com/re-cinq/lore/blob/main/adrs/ADR-1.md",
    );
  });

  it("uses the given branch in the GitHub URL", () => {
    expect(resolveHref("a.ts", "o/r", "develop").href).toEqual(
      "https://github.com/o/r/blob/develop/a.ts",
    );
  });

  it("leaves an absolute https URL unchanged and marks it external", () => {
    expect(
      resolveHref("https://example.com/x", "re-cinq/lore", "main"),
    ).toEqual({
      href: "https://example.com/x",
      external: true,
    });
  });

  it("leaves an in-page anchor unchanged and not external", () => {
    expect(resolveHref("#section", "re-cinq/lore", "main")).toEqual({
      href: "#section",
      external: false,
    });
  });

  it("leaves a relative path unchanged when repo is not owner/name", () => {
    expect(resolveHref("src/x.test.ts#L1", "unknown", "main")).toEqual({
      href: "src/x.test.ts#L1",
      external: false,
    });
  });

  it("returns empty external false for an empty href", () => {
    expect(resolveHref("", "re-cinq/lore", "main")).toEqual({
      href: "",
      external: false,
    });
  });
});

describe("SpecDetails sanitization", () => {
  it("strips an injected script element while still wrapping the statement", () => {
    const md =
      "## Acceptance Criteria\n\n<script>window.hacked = true;</script>\n\n- Claims a pending task.\n";
    const statements = [
      stmt({
        ordinal: 0,
        text: "Claims a pending task.",
        kind: "list-item",
        state: "untested",
      }),
    ];
    const { container } = renderSpec(md, statements);

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("window.hacked");
    expect(container.querySelector('mark[data-ordinal="0"]')).not.toBeNull();
  });

  it("removes an onerror handler from raw img HTML in the spec body", () => {
    const md =
      '## Overview\n\n<img src="https://example.com/x.png" onerror="window.hacked = true" />\n';
    const { container } = renderSpec(md, []);
    const img = container.querySelector("img");

    expect(img).not.toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("strips a javascript: href from a raw HTML anchor in the spec body", () => {
    const md = '## Overview\n\n<a href="javascript:alert(1)">bad</a>\n';
    const { container } = renderSpec(md, []);
    const link = container.querySelector("a");

    expect(link?.textContent).toEqual("bad");
    expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("drops an injected svg element carrying an onload handler from the spec body", () => {
    const md =
      '## Overview\n\n<svg onload="window.hacked = true"><circle r="9" /></svg>\n';
    const { container } = renderSpec(md, []);

    expect(container.querySelector("svg")).toBeNull();
  });
});
