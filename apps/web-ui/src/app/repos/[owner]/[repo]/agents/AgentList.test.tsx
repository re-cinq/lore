// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import AgentList from "./AgentList";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type {
  AgentApplyStatus,
  AgentUsage,
  AgentUsageRef,
} from "@/lib/agents-api";

const base = "/repos/re-cinq/lore";
const usageOf = (
  refs: Record<string, AgentUsageRef[]>,
  applied: Record<string, AgentApplyStatus[]> = {},
): AgentUsage => ({ refs, applied });
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
  it("renders one table row per definition under the Name/Scope/Model/Timeout/Mode/Used by/Rollout columns", () => {
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
      "Rollout",
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
        usage={usageOf({
          general: [
            { blueprint: "general", node_id: "implement", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "gap-fill", node_id: "refine", inherited: false },
          ],
        })}
      />,
    );

    expect(getByTestId("usage-general").textContent).toEqual(
      "used by general · implement, review; gap-fill · refine (station_ref)",
    );
  });

  it("an unreferenced claude-code definition reads as a single-agent task type, not dormant", () => {
    const { getByTestId } = render(
      <AgentList base={base} agents={[org]} usage={usageOf({})} />,
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
      <AgentList base={base} agents={[station]} usage={usageOf({})} />,
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
        usage={usageOf({
          general: [
            { blueprint: "general", node_id: "implement", inherited: true },
            { blueprint: "general", node_id: "review", inherited: true },
            { blueprint: "gap-fill", node_id: "refine", inherited: false },
          ],
        })}
      />,
    );

    expect(referenced.getByTestId("mode-general").textContent).toEqual(
      "general, gap-fill",
    );
    referenced.unmount();

    const blueprintless = render(
      <AgentList base={base} agents={[org]} usage={usageOf({})} />,
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

  it("a null base renders the read-only org catalog — no Edit column, org-default hint", () => {
    const { container, getByText, queryByText } = render(
      <AgentList base={null} agents={[org]} usage={usageOf({})} />,
    );

    expect(queryByText("Edit")).toBeNull();
    expect(container.querySelectorAll("thead th")).toHaveLength(7);
    expect(getByText(/org-default catalog every repo inherits/)).toBeTruthy();
  });

  it("orgEditable links each row to the global org-default editor", () => {
    const { getByText } = render(
      <AgentList base={null} agents={[org]} usage={usageOf({})} orgEditable />,
    );

    expect(getByText("Edit").getAttribute("href")).toBe(
      `/agents/edit/${org.name}`,
    );
    expect(
      getByText(/updates the organisation default for every repo/),
    ).toBeTruthy();
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
        usage={usageOf({
          "def-validate": [
            { blueprint: "general", node_id: "validate", inherited: true },
          ],
        })}
      />,
    );

    expect(getByTestId("mode-def-validate").textContent).toEqual("station");
  });
});

describe("the Rollout column", () => {
  const verdict = (over: Partial<AgentApplyStatus> = {}): AgentApplyStatus => ({
    name: "general",
    project_id: null,
    cluster: "central",
    state: "applied",
    reason: null,
    ...over,
  });

  it("names the cluster and the reason when one refused, so a refusal is not just a count", () => {
    const { getByTestId } = render(
      <AgentList
        base={base}
        agents={[org]}
        usage={usageOf(
          {},
          {
            general: [
              verdict(),
              verdict({
                cluster: "satellite-1",
                state: "refused",
                reason: "no anthropic credential",
              }),
            ],
          },
        )}
      />,
    );

    expect(getByTestId("rollout-general").textContent).toEqual(
      "satellite-1: refused — no anthropic credential",
    );
  });

  it("summarises the all-applied case by cluster count", () => {
    const { getByTestId } = render(
      <AgentList
        base={base}
        agents={[org]}
        usage={usageOf({}, { general: [verdict(), verdict({ cluster: "b" })] })}
      />,
    );

    expect(getByTestId("rollout-general").textContent).toEqual(
      "applied · 2 cluster(s)",
    );
  });

  it("says NOT REPORTED rather than claiming success when no cluster has answered", () => {
    const { getByTestId } = render(
      <AgentList base={base} agents={[org]} usage={usageOf({}, {})} />,
    );

    expect(getByTestId("rollout-general").textContent).toEqual("not reported");
  });

  it("renders a dash when the endpoint itself could not answer — unknown is never a verdict", () => {
    const { getByTestId } = render(
      <AgentList base={base} agents={[org]} usage={null} />,
    );

    expect(getByTestId("rollout-general").textContent).toEqual("—");
  });

  it("keeps an org default's verdict apart from a repo override's", () => {
    const project: AgentDefinition = { ...org, project_id: "p-1" };
    const { getByTestId } = render(
      <AgentList
        base={base}
        agents={[project]}
        usage={usageOf(
          {},
          {
            general: [
              verdict({ state: "refused", reason: "org-level problem" }),
              verdict({ project_id: "p-1", cluster: "central" }),
            ],
          },
        )}
      />,
    );

    expect(getByTestId("rollout-general").textContent).toEqual(
      "applied · 1 cluster(s)",
    );
  });
});
