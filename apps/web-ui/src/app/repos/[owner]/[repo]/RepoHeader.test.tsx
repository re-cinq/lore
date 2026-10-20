// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoHeader from "./RepoHeader";

vi.mock("@/components/Icon", () => ({ default: () => null }));

const record = {
  team: "platform",
  onboarded_at: "2026-03-01T00:00:00Z",
  last_ingested_at: null,
};

describe("RepoHeader", () => {
  it("names the repo under a breadcrumb back to the repository list", () => {
    render(<RepoHeader owner="re-cinq" repo="lore" record={null} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "lore" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the team, the ingest age and a GitHub link from Lore's record", () => {
    render(<RepoHeader owner="re-cinq" repo="lore" record={record} />);
    expect(screen.getByText("platform")).toBeInTheDocument();
    expect(screen.getByText("Ingested Never")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/re-cinq/lore",
    );
  });

  it("renders the GitHub description when there is one", () => {
    render(
      <RepoHeader
        owner="re-cinq"
        repo="lore"
        description="Shared context"
        record={null}
      />,
    );
    expect(screen.getByText("Shared context")).toBeInTheDocument();
  });
});
