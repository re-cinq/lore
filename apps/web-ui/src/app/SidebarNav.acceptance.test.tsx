// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

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
    render(<SidebarNav inboxCount={5} headlampUrl="https://headlamp" />);

    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    const inbox = links[0];

    expect(inbox).toHaveAttribute("href", "/inbox");
    expect(within(inbox).getByText("5")).toBeInTheDocument();
  });
});
