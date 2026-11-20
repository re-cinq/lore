// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoLayout from "./layout";
import { getRepo } from "@/lib/api/repos";

vi.mock("@/lib/github", () => ({
  getRepoMeta: vi.fn().mockResolvedValue({ description: "Test Repo" }),
}));

vi.mock("@/lib/api/repos", () => ({
  getRepo: vi.fn().mockResolvedValue({ status: "error" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/repos/re-cinq/lore/loops",
}));

vi.mock("@/components/Icon", () => ({ default: () => null }));

vi.mock("./TabNav", () => ({
  default: ({ tabs }: { tabs: { label: string }[] }) => (
    <div data-testid="tabnav">
      {tabs.map((t) => (
        <a key={t.label} href="#">
          {t.label}
        </a>
      ))}
    </div>
  ),
}));

describe("RepoLayout", () => {
  it("renders one Loops tab where Backlog and Triage were", async () => {
    const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });
    const jsx = await RepoLayout({ children: <div>child</div>, params });

    render(jsx);

    const links = screen.getAllByRole("link").map((l) => l.textContent);

    expect(links).toContain("Loops");
    expect(links).not.toContain("Backlog");
    expect(links).not.toContain("Triage");
  });
});

describe("RepoLayout public mirror chip", () => {
  const renderWith = async (settings: object) => {
    vi.mocked(getRepo).mockResolvedValueOnce({
      status: "ok",
      data: {
        team: null,
        onboarded_at: "2026-03-01T00:00:00Z",
        last_ingested_at: null,
        settings,
      },
    } as never);
    const params = Promise.resolve({ owner: "acme", repo: "private" });

    render(await RepoLayout({ children: <div>child</div>, params }));
  };

  it("renders the chip public: acme/public for a repo whose settings name it", async () => {
    await renderWith({ public_mirror: "acme/public" });

    expect(
      screen.getByRole("link", { name: "public: acme/public" }),
    ).toHaveAttribute("href", "https://github.com/acme/public");
  });

  it("renders no public chip for a repo whose settings name no mirror", async () => {
    await renderWith({});

    expect(screen.queryByText(/^public:/)).toEqual(null);
  });
});
