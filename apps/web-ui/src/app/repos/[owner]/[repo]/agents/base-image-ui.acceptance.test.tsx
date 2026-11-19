// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import AgentList from "./AgentList";
import type { AgentDefinition } from "@/lib/agents-mirror";
import SettingsView from "../settings/SettingsView";
import { INITIAL_SAVE_STATE } from "../settings/SaveResultBanner";

const listAgents = vi.fn();
const listOrgAgents = vi.fn();
const fetchAgentUsage = vi.fn();
const getRepo = vi.fn();
const getAgentActivity = vi.fn();

vi.mock("@/lib/agents-api", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  listOrgAgents: (...args: unknown[]) => listOrgAgents(...args),
  fetchAgentUsage: (...args: unknown[]) => fetchAgentUsage(...args),
}));
vi.mock("@/lib/api/repos", () => ({
  getRepo: (...args: unknown[]) => getRepo(...args),
  putRepoSettings: vi.fn(),
}));
vi.mock("@/lib/api/tasks", () => ({
  getAgentActivity: (...args: unknown[]) => getAgentActivity(...args),
}));

import RepoAgents from "./page";

const orgAgent: AgentDefinition = {
  name: "general",
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "p",
  image: "ubuntu:latest",
  execution_mode: "claude-code",
  review_required: true,
  config: null,
  project_id: null,
};

beforeEach(() => {
  listAgents.mockReset();
  listOrgAgents.mockReset();
  fetchAgentUsage.mockReset();
  getRepo.mockReset();
  getAgentActivity.mockReset();
});

describe("Base Image UI Controls (Acceptance)", () => {
  it("renders a curated base image selector in Settings with platform-published images and not a free-form input", () => {
    const { container } = render(
      <SettingsView
        fullName="re-cinq/lore"
        team="platform"
        settings={{ base_image: "node:20-alpine" }}
        allRepos={[]}
        saveAction={vi.fn(async () => INITIAL_SAVE_STATE)}
      />,
    );

    const select = container.querySelector('select[name="base_image"]');

    expect(select).not.toBeNull();
    const input = container.querySelector(
      'input[name="base_image"][type="text"]',
    );

    expect(input).toBeNull();
  });

  it("renders the base image selector and effective image resolution on the RepoAgents tab", async () => {
    listAgents.mockResolvedValue([orgAgent]);
    listOrgAgents.mockResolvedValue([orgAgent]);
    fetchAgentUsage.mockResolvedValue(null);
    getRepo.mockResolvedValue({
      status: "ok",
      data: {
        full_name: "re-cinq/lore",
        settings: { base_image: "node:20-alpine" },
      },
    });
    getAgentActivity.mockResolvedValue({ status: "ok", data: { agents: [] } });

    const page = (await RepoAgents({
      params: Promise.resolve({ owner: "re-cinq", repo: "lore" }),
    })) as ReactElement;
    const { container } = render(page);
    const select = container.querySelector(
      'select[name="base_image"]',
    ) as HTMLSelectElement;

    expect(select?.value).toBe("node:20-alpine");
    expect(container.textContent).toContain("repo-base");
  });

  it("displays the effective image labelled by its resolution layer in the AgentList", () => {
    const { getByText } = render(
      <AgentList base="/repos/re-cinq/lore" agents={[orgAgent]} />,
    );

    expect(getByText(/ubuntu:latest/)).toBeInTheDocument();
    expect(getByText(/org-default/)).toBeInTheDocument();
  });
});
