// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import BlockedReasonBanner from "./BlockedReasonBanner";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BlockedReasonBanner", () => {
  it("fetches the blocked reason and displays the label for a settled run with a PR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | Request | URL) => {
        if (
          url
            .toString()
            .includes("/api/repos/re-cinq/lore/pulls/42/blocked-reason")
        ) {
          return {
            ok: true,
            json: async () => ({ label: "Waiting for CI" }),
          };
        }

        return { ok: false, json: async () => null };
      }),
    );

    render(
      <BlockedReasonBanner
        repo="re-cinq/lore"
        prNumber={42}
        runStatus="settled"
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/repos/re-cinq/lore/pulls/42/blocked-reason",
        ),
        expect.anything(),
      );
    });

    expect(screen.getByText("Waiting for CI")).toBeInTheDocument();
  });
});
