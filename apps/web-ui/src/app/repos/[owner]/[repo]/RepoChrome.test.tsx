// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RepoChrome from "./RepoChrome";

const pathnameMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

const base = "/repos/re-cinq/lore";

function renderChrome() {
  render(
    <RepoChrome
      base={base}
      fullName="re-cinq/lore"
      full={<header>Repo header</header>}
    />,
  );
}

describe("RepoChrome", () => {
  it("draws the breadcrumb to Plans on a plan page", () => {
    pathnameMock.mockReturnValue(`${base}/plans/p1`);

    renderChrome();

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    const links = Array.from(crumbs.querySelectorAll("a")).map((link) => ({
      label: link.textContent,
      href: link.getAttribute("href"),
    }));

    expect(links).toEqual([
      { label: "Repositories", href: "/" },
      { label: "re-cinq/lore", href: base },
      { label: "Plans", href: `${base}/plans` },
    ]);
    expect(screen.queryByText("Repo header")).toBeNull();
  });

  it("draws the repo header on the Loops tab", () => {
    pathnameMock.mockReturnValue(`${base}/loops`);

    renderChrome();

    expect(screen.getByText("Repo header")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
  });
});
