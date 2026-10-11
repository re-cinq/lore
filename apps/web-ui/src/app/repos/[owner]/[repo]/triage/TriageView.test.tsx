// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import TriageView from "./TriageView";

describe("TriageView", () => {
  it("groups issues under their triage label heading", () => {
    render(
      <TriageView
        issues={[
          { title: "Crash on save", triage_label: "triage: diagnosed" },
          { title: "Slow search", triage_label: "triage: needs-triage" },
          { title: "Bad font", triage_label: "triage: diagnosed" },
        ]}
      />,
    );

    const diagnosed = screen.getByRole("region", { name: "triage: diagnosed" });

    expect(
      within(diagnosed)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual(["Crash on savetriage: diagnosed", "Bad fonttriage: diagnosed"]);
  });

  it("links a row to /assembly-runs/run-1 when its run is active", () => {
    render(
      <TriageView
        issues={[
          {
            title: "Crash on save",
            triage_label: "triage: reproducing",
            active_run_link: "/assembly-runs/run-1",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "View run" }).getAttribute("href"),
    ).toBe("/assembly-runs/run-1");
  });

  it("says no issues are in triage when the list is empty", () => {
    render(<TriageView issues={[]} />);

    expect(
      screen.getByText("No open issues carry a triage label."),
    ).toBeTruthy();
  });
});
