// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const linkStatus = vi.fn(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus() };
});

import EditLink from "./EditLink";

describe("EditLink", () => {
  it("shows Edit with a spinner, busy, while the edit page loads", () => {
    linkStatus.mockReturnValue({ pending: true });
    render(<EditLink href="/agents/edit/loop-tdd" />);

    expect({
      busy: screen.getByText("Edit").getAttribute("aria-busy"),
      spinner: screen.queryByRole("status", { name: "Loading" }) !== null,
    }).toEqual({ busy: "true", spinner: true });
  });

  it("shows Edit with no spinner before it is clicked", () => {
    linkStatus.mockReturnValue({ pending: false });
    render(<EditLink href="/agents/edit/loop-tdd" />);

    expect({
      busy: screen.getByText("Edit").getAttribute("aria-busy"),
      spinner: screen.queryByRole("status", { name: "Loading" }) !== null,
    }).toEqual({ busy: "false", spinner: false });
  });

  it("links Edit to /agents/edit/loop-tdd", () => {
    linkStatus.mockReturnValue({ pending: false });
    render(<EditLink href="/agents/edit/loop-tdd" />);

    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href"),
    ).toBe("/agents/edit/loop-tdd");
  });
});
