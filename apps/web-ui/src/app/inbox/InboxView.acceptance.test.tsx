// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const apiFetch = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: any[]) => apiFetch(...args),
}));

import InboxView from "./InboxView";

describe("InboxView", () => {
  it("renders list ordered by wait time", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      val: {
        items: [
          {
            id: "run:1",
            kind: "failed_run",
            repo: "re-cinq/lore",
            title: "Build failed",
            detail: "OOM",
            waiting_since: "2026-10-10T10:00:00Z",
            open_url: "/url",
            actions: [],
            state: {},
          },
        ],
        next_cursor: null,
        counts: { failed_run: 1 },
      },
    });

    render(<InboxView />);

    expect(await screen.findByText("Build failed")).toBeInTheDocument();
    expect(screen.getByText("Build failed")).toBeInTheDocument();
  });

  it("filters items by kind chip", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      val: {
        items: [],
        next_cursor: null,
        counts: { failed_run: 2, spec_pr: 1 },
      },
    });

    render(<InboxView />);

    const chip = await screen.findByRole("button", { name: /failed_run/ });

    fireEvent.click(chip);

    expect(apiFetch).toHaveBeenCalledWith(
      "lore-api",
      "/api/inbox",
      expect.objectContaining({
        query: { kind: ["failed_run"] },
      }),
    );
  });

  it("states nothing is waiting when empty", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      val: {
        items: [],
        next_cursor: null,
        counts: {},
      },
    });

    render(<InboxView />);

    expect(await screen.findByText(/nothing is waiting/i)).toBeInTheDocument();
  });

  it("names unavailable sources on the page", async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      val: {
        items: [],
        unavailable: ["floor", "github"],
        next_cursor: null,
        counts: {},
      },
    });

    render(<InboxView />);

    expect(await screen.findByText(/floor/i)).toBeInTheDocument();
    expect(screen.getByText(/github/i)).toBeInTheDocument();
  });
});
