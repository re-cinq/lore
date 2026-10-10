// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoLayout from "./layout";

vi.mock("@/lib/github", () => ({
  getRepoMeta: vi.fn().mockResolvedValue({ description: "Test Repo" }),
}));

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
  it("renders Triage tab alongside Backlog", async () => {
    const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });
    const jsx = await RepoLayout({ children: <div>child</div>, params });
    render(jsx);

    const links = screen.getAllByRole("link").map((l) => l.textContent);
    expect(links).toContain("Backlog");
    expect(links).toContain("Triage");
  });
});
