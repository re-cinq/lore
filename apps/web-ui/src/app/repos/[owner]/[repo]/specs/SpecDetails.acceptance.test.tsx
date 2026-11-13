// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpecDetails from "./SpecDetails";
import {
  toStatementInfo,
  type GraphStatement,
} from "@/lib/trace-statement-info";

const REPO = "re-cinq/lore";

describe("T104: Rewrite rehype highlighter", () => {
  it("determines a statement is tested by finding a test link mid-statement, overriding a graph state of untested", () => {
    const md = "## Features\n\nIt [does it](src/a.test.ts#L1) well.\n";
    const graphStatements: GraphStatement[] = [
      {
        ordinal: 1,
        text: "It [does it](src/a.test.ts#L1) well.",
        state: "untested",
        links: [],
      },
    ];

    const statements = toStatementInfo(graphStatements);
    const { container } = render(
      <SpecDetails repo={REPO} content={md} statements={statements} />,
    );
    const mark = container.querySelector('mark[data-ordinal="1"]');

    expect(mark?.className).toContain("stmt-tested");
    expect(mark?.getAttribute("data-state")).toBe("tested");
  });

  it("surfaces the narrative section category in the hover popover", () => {
    const md = "## Problem Statement\n\nWe need this.\n";
    const graphStatements: GraphStatement[] = [
      {
        ordinal: 1,
        text: "We need this.",
        state: "narrative",
        testability: "background",
        links: [],
      },
    ];

    const statements = toStatementInfo(graphStatements);
    const { container } = render(
      <SpecDetails repo={REPO} content={md} statements={statements} />,
    );
    const mark = container.querySelector('mark[data-ordinal="1"]');

    expect(mark?.className).toContain("stmt-narrative");

    fireEvent.mouseOver(mark!);
    const tooltip = screen.getByRole("tooltip");

    expect(tooltip.textContent).toContain("Narrative");
    expect(tooltip.textContent).toContain("background");
  });
});
