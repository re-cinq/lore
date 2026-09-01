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
  it("renders one table row per definition under the Name/Scope/Model/Timeout/Mode/Used by columns", () => {
    const { container } = render(
      <AgentList base={base} agents={[org, project]} />,
    );
    const headers = Array.from(container.querySelectorAll("thead th")).map(
      (th) => th.textContent,
    );

    expect(headers).toEqual([
      "Name",
      "Scope",
      "Model",
      "Timeout",
      "Mode",
      "Used by",
      "",
    ]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

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

  it("shows the blueprint nodes that use a definition, naming each line once with its nodes grouped and duplicates collapsed", () => {
    const { getByTestId } = render(
      <AgentList
        base={base}
        agents={[org]}
        usage={{
          general: [
            { blueprint: "general", node_id: "implement", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "gap-fill", node_id: "refine", inherited: false },
          ],
        }}
      />,
    );

    expect(getByTestId("usage-general").textContent).toEqual(
      "used by general · implement, review; gap-fill · refine (station_ref)",
    );
  });

  it("an unreferenced claude-code definition reads as a single-agent task type, not dormant", () => {
    const { getByTestId } = render(
      <AgentList base={base} agents={[org]} usage={{}} />,
    );

    expect(getByTestId("usage-general").textContent).toEqual(
      "no assembly line — runs as a single agent",
    );
  });

  it("an unreferenced station-mode definition is flagged as not referenced by any assembly line", () => {
    const station: AgentDefinition = {
      ...org,
      name: "def-github_action",
      execution_mode: "station",
    };
    const { getByTestId } = render(
      <AgentList base={base} agents={[station]} usage={{}} />,
    );

    expect(getByTestId("usage-def-github_action").textContent).toEqual(
      "not referenced by any assembly line",
    );
  });

  it("null usage (endpoint unreachable) renders a dash, never an unreferenced claim", () => {
    const { getByTestId } = render(
      <AgentList base={base} agents={[org]} usage={null} />,
    );

    expect(getByTestId("usage-general").textContent).toEqual("—");
  });

  it("the Mode cell shows the deduped line names for a referenced claude-code recipe, single agent for a blueprint-less one, and the raw mode when usage is unknown", () => {
    const referenced = render(
      <AgentList
        base={base}
        agents={[org]}
        usage={{
          general: [
            { blueprint: "general", node_id: "implement", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "gap-fill", node_id: "refine", inherited: false },
          ],
        }}
      />,
    );

    expect(referenced.getByTestId("mode-general").textContent).toEqual(
      "general, gap-fill",
    );
    referenced.unmount();

    const blueprintless = render(
      <AgentList base={base} agents={[org]} usage={{}} />,
    );

    expect(blueprintless.getByTestId("mode-general").textContent).toEqual(
      "single agent",
    );
    blueprintless.unmount();

    const unknown = render(
      <AgentList base={base} agents={[org]} usage={null} />,
    );

    expect(unknown.getByTestId("mode-general").textContent).toEqual(
      "claude-code",
    );
  });

  it("the Mode cell keeps the station tag even when lines reference the station", () => {
    const station: AgentDefinition = {
      ...org,
      name: "def-validate",
      execution_mode: "station",
    };
    const { getByTestId } = render(
      <AgentList
        base={base}
        agents={[station]}
        usage={{
          "def-validate": [
            { blueprint: "general", node_id: "validate", inherited: true },
          ],
        }}
      />,
    );

    expect(getByTestId("mode-def-validate").textContent).toEqual("station");
  });
});
