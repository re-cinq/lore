// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GithubConnectSection from "./GithubConnectSection";

vi.mock("@/components/Icon", () => ({ default: () => <span /> }));

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
      "re-cinqOrganization · selected reposInstalled",
    );
  });

  it("marks a suspended installation as Suspended rather than Installed", () => {
    render(
      <GithubConnectSection
        installations={[{ ...RE_CINQ, suspended_at: "2026-10-01T09:00:00Z" }]}
        installUrl={null}
      />,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(/Suspended$/);
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

  it("offers no install link while the App's slug is not configured", () => {
    render(
      <GithubConnectSection installations={[RE_CINQ]} installUrl={null} />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says Lore is not connected to any GitHub account yet when none is recorded", () => {
    render(
      <GithubConnectSection
        installations={[]}
        installUrl="https://github.com/apps/lore-agent/installations/new"
      />,
    );

    expect(
      screen.getByText("Lore is not connected to any GitHub account yet."),
    ).toBeInTheDocument();
  });
});
