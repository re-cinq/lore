// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionLengthForm from "./SessionLengthForm";

const lengthSelect = () =>
  screen.getByLabelText("Session length") as HTMLSelectElement;

describe("SessionLengthForm", () => {
  it("offers 8 hours, 1 day, 7 days and 30 days, with 8 hours selected when nothing is saved", () => {
    render(
      <SessionLengthForm sessionLengthHours="" saveSessionLength={vi.fn()} />,
    );

    expect({
      options: [...lengthSelect().options].map((option) => [
        option.value,
        option.textContent,
      ]),
      selected: lengthSelect().value,
    }).toEqual({
      options: [
        ["8", "8 hours"],
        ["24", "1 day"],
        ["168", "7 days"],
        ["720", "30 days"],
      ],
      selected: "8",
    });
  });

  it("shows a saved 168 as 7 days", () => {
    render(
      <SessionLengthForm
        sessionLengthHours="168"
        saveSessionLength={vi.fn()}
      />,
    );

    expect(lengthSelect().value).toBe("168");
  });

  it("says a new length applies from the next sign-in and what a longer one costs", () => {
    render(
      <SessionLengthForm sessionLengthHours="" saveSessionLength={vi.fn()} />,
    );

    expect(screen.getByText(/next sign-in/).textContent).toBe(
      "A new length applies from each person's next sign-in. Someone removed from the GitHub organisation keeps their access until their session ends.",
    );
  });
});
