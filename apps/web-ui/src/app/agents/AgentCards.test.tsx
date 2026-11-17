// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentCards from "./AgentCards";
import type { AgentDefinition } from "@/lib/agents-mirror";

const triage: AgentDefinition = {
  name: "acme-triage",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "p",
  image: null,
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};
const catalog = { usage: null, activity: null, presence: null };

describe("AgentCards", () => {
  it("links Edit to /agents/edit/loop-tdd and not for the pack-managed acme-triage", () => {
    const { container } = render(
      <AgentCards
        agents={[
          { ...triage, pack_managed: true },
          { ...triage, name: "loop-tdd", pack_managed: false },
        ]}
        catalog={catalog}
      />,
    );

    expect(
      Array.from(container.querySelectorAll("a")).map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual(["/agents/edit/loop-tdd"]);
  });

  it("says Managed by pack on the acme-triage card", () => {
    render(
      <AgentCards
        agents={[{ ...triage, pack_managed: true }]}
        catalog={catalog}
      />,
    );

    expect(screen.getByText("Managed by pack")).toBeTruthy();
  });
});
