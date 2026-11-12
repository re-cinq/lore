// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmedActionButton from "./ConfirmedActionButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DANGER_QUESTION = {
  title: "Regenerate the plan?",
  body: "This starts a new planning run.",
  confirmLabel: "Regenerate",
  tone: "danger",
} as const;

function renderButton(buttonClassName?: string) {
  render(
    <ConfirmedActionButton
      action={async () => ({})}
      label="Regenerate plan"
      question={DANGER_QUESTION}
      buttonClassName={buttonClassName}
    />,
  );
}

describe("ConfirmedActionButton", () => {
  it("draws the trigger in the question's tone by default", () => {
    renderButton();

    expect(
      screen.getByRole("button", { name: "Regenerate plan" }).className,
    ).toBe("danger");
  });

  it("draws the trigger in the given class and the dialog's confirm in the question's tone", () => {
    renderButton("");
    const trigger = screen.getByRole("button", { name: "Regenerate plan" });

    fireEvent.click(trigger);

    expect({
      trigger: trigger.className,
      confirm: screen.getByRole("button", { name: "Regenerate" }).className,
    }).toEqual({ trigger: "", confirm: "danger" });
  });
});
