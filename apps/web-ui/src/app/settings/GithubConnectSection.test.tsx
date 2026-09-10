// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GithubConnectSection from "./GithubConnectSection";

const RE_CINQ = {
  installation_id: "81234567",
  account_login: "re-cinq",
  account_type: "Organization" as const,
  repository_selection: "selected" as const,
  suspended_at: null,
  installed_at: "2026-09-10T20:00:00.000Z",
  updated_at: "2026-09-10T20:00:00.000Z",
};

describe("GithubConnectSection", () => {
  it("lists re-cinq as a connected organization on selected repos", () => {
    render(
      <GithubConnectSection
        installations={[RE_CINQ]}
        installUrl="https://github.com/apps/lore-agent/installations/new"
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(
      "re-cinq — Organization, selected repos",
    );
  });

  it("links to installing the App on another account at the lore-agent install URL", () => {
    render(
      <GithubConnectSection
        installations={[RE_CINQ]}
        installUrl="https://github.com/apps/lore-agent/installations/new"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Install on another account" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/apps/lore-agent/installations/new",
    );
  });
});
