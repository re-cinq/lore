// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

let pending = false;
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending }),
}));

import FilterChip from "./FilterChip";

afterEach(() => {
  pending = false;
});

describe("FilterChip", () => {
  it("renders a link with its href and label, marking active", () => {
    render(
      <FilterChip href="/context?type=doc" active>
        doc
      </FilterChip>,
    );
    const link = screen.getByRole("link", { name: "doc" });
    expect(link).toHaveAttribute("href", "/context?type=doc");
    expect(link).toHaveClass("active");
  });

  it("omits the active class when not selected", () => {
    render(
      <FilterChip href="/context" active={false}>
        All
      </FilterChip>,
    );
    expect(screen.getByRole("link", { name: "All" })).not.toHaveClass("active");
  });

  it("shows a spinner while its navigation is in flight", () => {
    pending = true;
    const { container } = render(
      <FilterChip href="/context" active={false}>
        All
      </FilterChip>,
    );
    expect(container.querySelector(".chip-spinner")).not.toBeNull();
  });

  it("shows no spinner when idle", () => {
    const { container } = render(
      <FilterChip href="/context" active={false}>
        All
      </FilterChip>,
    );
    expect(container.querySelector(".chip-spinner")).toBeNull();
  });
});
