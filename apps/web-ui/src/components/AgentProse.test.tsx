// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentProse from "./AgentProse";

const ROUND_SUMMARY = [
  "Branch is up to date. Round summary:",
  "",
  "**This round (Green facet):** Created `apps/web/src/chat/protocol.ts`.",
  "",
  "**0 regressions** — only the 6 tests I wrote this round ran, all green.",
  "",
  'LORE_NODE_RESULT: {"outcome":"success","extras":{"Lore-Tdd-Done":"Green: protocol.ts + chatReducer.ts","Lore-Tdd-Next":"socket/UI facets"}}',
].join("\n");

describe("AgentProse", () => {
  it("renders the agent's markdown as markup: bold as <strong>, backticks as <code>", () => {
    const { container } = render(<AgentProse text={ROUND_SUMMARY} />);

    expect(container.querySelector("strong")).toHaveTextContent(
      "This round (Green facet):",
    );
    expect(container.querySelector("code")).toHaveTextContent(
      "apps/web/src/chat/protocol.ts",
    );
  });

  it("draws the LORE_NODE_RESULT line as a card naming the outcome 'success' and each extra, not as JSON prose", () => {
    const { container } = render(<AgentProse text={ROUND_SUMMARY} />);
    const card = container.querySelector('[data-node-result="success"]');

    expect(card?.textContent).toBe(
      "Node resultsuccessLore-Tdd-DoneGreen: protocol.ts + chatReducer.tsLore-Tdd-Nextsocket/UI facets",
    );
    expect(screen.queryByText(/LORE_NODE_RESULT/)).toBeNull();
  });

  it("flags an unparseable LORE_NODE_RESULT payload on the card, quoting it", () => {
    const { container } = render(
      <AgentProse text={'LORE_NODE_RESULT: {"outcome":"done"}'} />,
    );

    expect(
      container.querySelector('[data-node-result="unparseable"]'),
    ).toHaveTextContent('unparseable{"outcome":"done"}');
  });

  it("draws no card for prose without a marker line", () => {
    const { container } = render(<AgentProse text="Just thinking aloud." />);

    expect(container.querySelector("[data-node-result]")).toBeNull();
    expect(screen.getByText("Just thinking aloud.")).toBeInTheDocument();
  });
});
