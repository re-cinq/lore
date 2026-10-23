// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/changelog", () => ({ getChangelog: vi.fn() }));

import { getChangelog } from "@/lib/api/changelog";
import ChangelogPage from "./ChangelogPage";

const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });

function page(searchParams: { before?: string; by?: string } = {}) {
  return ChangelogPage({ params, searchParams: Promise.resolve(searchParams) });
}

describe("ChangelogPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks lore-api for re-cinq/lore's weeks before 2026-W42", async () => {
    vi.mocked(getChangelog).mockResolvedValue({
      status: "ok",
      data: { weeks: [], next: null },
    });
    render(await page({ before: "2026-W42" }));

    expect(vi.mocked(getChangelog).mock.calls).toEqual([
      ["re-cinq/lore", { before: "2026-W42" }],
    ]);
  });

  it("names lore-api's error when the changelog cannot be read", async () => {
    vi.mocked(getChangelog).mockResolvedValue({
      status: "error",
      message: "HTTP 503",
    });
    render(await page());

    expect(
      screen.getByText(/Could not load the changelog \(HTTP 503\)/),
    ).not.toBe(null);
  });
});
