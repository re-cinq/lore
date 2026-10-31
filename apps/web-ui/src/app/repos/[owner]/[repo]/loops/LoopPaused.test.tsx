// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import LoopPaused from "./LoopPaused";

const creditPause = {
  reason: "model credit exhausted",
  run_id: "run-7",
  at: "2026-10-31T09:00:00.000Z",
  until: null,
};

describe("LoopPaused", () => {
  it("says the loop is paused for model credit and links run-7, which paused it", () => {
    const { getByRole } = render(
      <LoopPaused pause={creditPause} resume={async () => null} />,
    );

    expect({
      text: getByRole("status").textContent,
      run: getByRole("link", { name: "the run that paused it" }).getAttribute(
        "href",
      ),
    }).toMatchObject({
      text: expect.stringContaining("Paused: model credit exhausted · since"),
      run: "/assembly-runs/run-7",
    });
  });

  it("says until when a pause that ends on 2026-11-03 holds", () => {
    const { getByRole } = render(
      <LoopPaused
        pause={{ ...creditPause, until: "2026-11-03T09:00:00.000Z" }}
        resume={async () => null}
      />,
    );

    expect(getByRole("status").textContent).toContain(
      `· until ${new Date("2026-11-03T09:00:00.000Z").toLocaleString()} ·`,
    );
  });

  it("resumes the loop through the bound action when Resume is clicked", async () => {
    const resume = vi.fn(async () => null);
    const { getByRole } = render(
      <LoopPaused pause={creditPause} resume={resume} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Resume" }));
    });

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("says why lore-api refused the resume", async () => {
    const { getByRole } = render(
      <LoopPaused
        pause={creditPause}
        resume={async () => "repo not found: re-cinq/lore"}
      />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: "Resume" }));
    });

    expect(getByRole("alert").textContent).toBe("repo not found: re-cinq/lore");
  });
});
