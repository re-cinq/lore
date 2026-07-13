// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Keep the real Link, stub useLinkStatus so we control the pending state.
const linkStatus = vi.fn(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus() };
});

import NavLink, { NavLabel } from "./NavLink";

describe("NavLabel", () => {
  it("shows a loading spinner when pending", () => {
    render(<NavLabel label="Specs" pending={true} />);
    expect(screen.getByText("Specs")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "loading" })).toBeInTheDocument();
  });

  it("shows no spinner when not pending", () => {
    render(<NavLabel label="Specs" pending={false} />);
    expect(screen.getByText("Specs")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("NavLink", () => {
  it("applies the active class and aria-current when active", () => {
    render(<NavLink href="/x" label="X" active={true} className="tab-link" />);
    const link = screen.getByRole("link", { name: "X" });

    expect(link.className).toContain("tab-link");
    expect(link.className).toContain("active");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("omits the active class and aria-current when inactive", () => {
    render(<NavLink href="/x" label="X" active={false} className="tab-link" />);
    const link = screen.getByRole("link", { name: "X" });

    expect(link.className).not.toContain("active");
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("renders the pending spinner while the link navigation is pending", () => {
    linkStatus.mockReturnValueOnce({ pending: true });
    render(<NavLink href="/x" label="X" active={false} className="tab-link" />);
    expect(screen.getByRole("status", { name: "loading" })).toBeInTheDocument();
  });
});
