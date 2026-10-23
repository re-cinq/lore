// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoLayout from "./layout";

vi.mock("@/lib/github", () => ({
  getRepoMeta: vi.fn().mockResolvedValue({ description: "Test Repo" }),
}));

vi.mock("@/lib/api/repos", () => ({
  getRepo: vi.fn().mockResolvedValue({ status: "error" }),
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
