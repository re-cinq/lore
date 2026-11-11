// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const linkStatus = vi.fn(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus() };
});

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-icon={name} aria-hidden="true" />
  ),
}));

import SidebarNav from "./SidebarNav";

describe("SidebarNav", () => {
  it("shows Inbox as the first link of the top group carrying a badge of open items", () => {
    render(<SidebarNav headlampUrl="https://headlamp" />);

    const link = screen.getByRole("link", { name: /Inbox/ });

    expect(link).toBeInTheDocument();
  });
});
