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

describe("RepoHeader on host ghe.example.com", () => {
  it("links to https://ghe.example.com/re-cinq/lore", () => {
    render(
      <RepoHeader
        owner="re-cinq"
        repo="lore"
        record={record}
        host="ghe.example.com"
      />,
    );
    expect(screen.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://ghe.example.com/re-cinq/lore",
    );
  });
});

describe("RepoHeader public mirror chip", () => {
  it("links the chip public: acme/public to https://github.com/acme/public", () => {
    render(
      <RepoHeader
        owner="acme"
        repo="private"
        record={record}
        publicMirror="acme/public"
      />,
    );
    expect(
      screen.getByRole("link", { name: "public: acme/public" }),
    ).toHaveAttribute("href", "https://github.com/acme/public");
  });

  it("links the chip to https://ghe.example.com/acme/public on that host", () => {
    render(
      <RepoHeader
        owner="acme"
        repo="private"
        record={record}
        publicMirror="acme/public"
        host="ghe.example.com"
      />,
    );
    expect(
      screen.getByRole("link", { name: "public: acme/public" }),
    ).toHaveAttribute("href", "https://ghe.example.com/acme/public");
  });

  it("shows no chip without a mirror", () => {
    render(<RepoHeader owner="acme" repo="private" record={record} />);
    expect(screen.queryByText(/^public:/)).toBeNull();
  });
});
