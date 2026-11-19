// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import AgentList from "./AgentList";
import type { AgentDefinition } from "@/lib/agents-mirror";
import type { AgentUsage, AgentUsageRef } from "@/lib/agents-api";

const base = "/repos/re-cinq/lore";
const usageOf = (refs: Record<string, AgentUsageRef[]>): AgentUsage => ({
  refs,
});
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

  it("links Edit for the project variant of triage and not for the pack-managed org default of general, keeping the row's cell count", () => {
    const packManaged = { ...org, pack_managed: true };
    const variant = { ...org, name: "triage", project_id: "p1" };
    const { container } = render(
      <AgentList base={base} agents={[packManaged, variant]} />,
    );
    const rows = Array.from(container.querySelectorAll("tbody tr"));

    expect({
      hrefs: rows.map((row) =>
        Array.from(row.querySelectorAll("a")).map((a) =>
          a.getAttribute("href"),
        ),
      ),
      cells: rows.map((row) => row.querySelectorAll("td").length),
      note: rows[0].lastElementChild?.textContent,
    }).toEqual({
      hrefs: [[], [`${base}/agents/triage/edit`]],
      cells: [7, 7],
      note: "Managed by pack",
    });
  });

  it("hides Edit for a pack-managed row in the editable org catalog too", () => {
    const { container } = render(
      <AgentList
        base={null}
        orgEditable
        agents={[{ ...org, pack_managed: true }]}
      />,
    );

    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("offers Remove on the project-scoped row only — an org default has no override to drop", () => {
    const { container } = render(
      <AgentList base={base} agents={[org, project]} remove={vi.fn()} />,
    );
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    const removeIn = (row: Element) =>
      Array.from(row.querySelectorAll("button")).map((b) => b.textContent);

    expect(removeIn(rows[0])).toEqual([]);
    expect(removeIn(rows[1])).toEqual(["Remove"]);
  });

  it("renders no Remove when the page passes no remove action", () => {
    const { queryByText } = render(
      <AgentList base={base} agents={[project]} />,
    );

    expect(queryByText("Remove")).toBeNull();
  });

  it("renders no Remove in the org catalog, where a definition belongs to no repo", () => {
    const { queryByText } = render(
      <AgentList base={null} agents={[project]} orgEditable />,
    );

    expect(queryByText("Remove")).toBeNull();
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
    expect(container.querySelectorAll("thead th")).toHaveLength(6);
    expect(getByText(/org-default catalog every repo inherits/)).toBeTruthy();
  });

  it("orgEditable links each row to the global org-default editor", () => {
    const { getByText } = render(
      <AgentList base={null} agents={[org]} usage={usageOf({})} orgEditable />,
    );

    expect(getByText("Edit").closest("a")?.getAttribute("href")).toBe(
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

  it("displays the effective image and its resolution layer (org-default, repo-base, agent-override) on a repo's Agents tab", () => {
    const orgWithImage: AgentDefinition = { ...org, image: "ubuntu:22.04" };
    const projectWithImage: AgentDefinition = {
      ...project,
      image: "node:22-alpine",
    };
    const { getByText } = render(
      <AgentList
        base={base}
        baseImage="node:20-alpine"
        orgImages={{ general: "ubuntu:22.04", review: "ubuntu:22.04" }}
        agents={[orgWithImage, projectWithImage]}
      />,
    );

    expect(getByText("node:20-alpine")).toBeInTheDocument();
    expect(getByText("repo-base")).toBeInTheDocument();
    expect(getByText("node:22-alpine")).toBeInTheDocument();
  });

  it("labels an inherited agent's image as org-default when no repo base image is set", () => {
    const orgWithImage: AgentDefinition = { ...org, image: "ubuntu:22.04" };
    const { getByText } = render(
      <AgentList base={base} agents={[orgWithImage]} />,
    );

    expect(getByText("ubuntu:22.04")).toBeInTheDocument();
    expect(getByText("org-default")).toBeInTheDocument();
  });
});
