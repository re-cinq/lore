// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/triage", () => ({ getTriageIssues: vi.fn() }));

import { getTriageIssues } from "@/lib/api/triage";
import TriageBody from "./TriageBody";

const fullName = "re-cinq/lore";

describe("TriageBody", () => {
  it("renders the issues of re-cinq/lore read through the triage client", async () => {
    vi.mocked(getTriageIssues).mockResolvedValue({
      status: "ok",
      data: [{ title: "Crash on save", triage_label: "triage: diagnosed" }],
    });

    render(await TriageBody({ fullName }));

    expect(getTriageIssues).toHaveBeenCalledWith("re-cinq/lore");
    expect(screen.getByText("Crash on save")).toBeTruthy();
  });

  it("names the API error when the triage list cannot be read", async () => {
    vi.mocked(getTriageIssues).mockResolvedValue({
      status: "error",
      message: "HTTP 502",
    });

    render(await TriageBody({ fullName }));

    expect(
      screen.getByText(/Could not load triage issues \(HTTP 502\)/),
    ).toBeTruthy();
  });
});
