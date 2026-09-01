// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import AgentList from "./AgentList";
import type { AgentDefinition } from "@/lib/agents-mirror";

const base = "/repos/re-cinq/lore";
const org: AgentDefinition = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "p",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};
const project: AgentDefinition = { ...org, name: "review", project_id: "p1" };

describe("AgentList", () => {
  it('labels an inherited agent "org" and an overridden one "project"', () => {
    const { container } = render(
      <AgentList base={base} agents={[org, project]} />,
    );
    const pills = Array.from(container.querySelectorAll(".status-pill")).map(
      (p) => p.textContent,
    );

    expect(pills).toEqual(["org", "project"]);
  });

  it("links each card to its edit page", () => {
    const { container } = render(<AgentList base={base} agents={[org]} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );

    expect(hrefs).toContain(`${base}/agents/general/edit`);
  });

  it("shows an empty state when there are no agent definitions", () => {
    const { getByText } = render(<AgentList base={base} agents={[]} />);

    expect(getByText(/No agent definitions resolved/)).toBeInTheDocument();
  });
});
