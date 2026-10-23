// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/code-review", () => ({ getCodeReview: vi.fn() }));

import { getCodeReview } from "@/lib/api/code-review";
import ReviewBody from "./ReviewBody";

describe("ReviewBody", () => {
  it("renders the review queues of re-cinq/lore read through the code-review client", async () => {
    vi.mocked(getCodeReview).mockResolvedValue({
      status: "ok",
      data: { current: [], open_pulls: [], recent: [] },
    });

    render(await ReviewBody({ fullName: "re-cinq/lore" }));

    expect({
      read: vi.mocked(getCodeReview).mock.calls,
      heading: screen.getByRole("heading", { name: "Current" }).textContent,
    }).toEqual({ read: [["re-cinq/lore"]], heading: "Current" });
  });

  it("names the API error when the queues cannot be read", async () => {
    vi.mocked(getCodeReview).mockResolvedValue({
      status: "error",
      message: "HTTP 502",
    });

    render(await ReviewBody({ fullName: "re-cinq/lore" }));

    expect(
      screen.getByText(/Could not load the code-review state \(HTTP 502\)/),
    ).toBeTruthy();
  });
});
