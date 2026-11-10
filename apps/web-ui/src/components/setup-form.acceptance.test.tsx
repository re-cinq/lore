// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ReonboardButton from "./ReonboardButton";
import SetupWebhookButton from "./SetupWebhookButton";

describe("Setup forms against FR-4.4 (Acceptance)", () => {
  it("surfaces setup-form refusal errors and uses the shared pending-state submit button (ReonboardButton)", async () => {
    let resolveAction: (val: unknown) => void;
    const actionPromise = new Promise((resolve) => {
      resolveAction = resolve;
    });
    const failingAction = vi.fn(async () => {
      await actionPromise;

      return { error: "Onboarding refused: duplicate task" };
    });

    render(<ReonboardButton action={failingAction} text="Open enrolment PR" />);

    const button = screen.getByRole("button", { name: "Open enrolment PR" });
    const form = button.closest("form");

    fireEvent.submit(form!);

    expect({
      form: form !== null,
      disabled: button.hasAttribute("disabled"),
      text: button.textContent,
    }).toEqual({
      form: true,
      disabled: true,
      text: "starting the run…",
    });

    resolveAction!({ error: "Onboarding refused: duplicate task" });

    await waitFor(() => {
      expect(
        screen.getByText("Onboarding refused: duplicate task"),
      ).toBeInTheDocument();
    });

    expect({
      disabled: button.hasAttribute("disabled"),
      text: button.textContent,
    }).toEqual({
      disabled: false,
      text: "Open enrolment PR",
    });
  });

  it("surfaces setup-form refusal errors and uses the shared pending-state submit button (SetupWebhookButton)", async () => {
    let resolveAction: (val: unknown) => void;
    const actionPromise = new Promise((resolve) => {
      resolveAction = resolve;
    });
    const failingAction = vi.fn(async () => {
      await actionPromise;

      return { error: "Webhook setup failed" };
    });

    render(<SetupWebhookButton action={failingAction} text="set up" />);

    const button = screen.getByRole("button", { name: "set up" });
    const form = button.closest("form");

    fireEvent.submit(form!);

    expect({
      form: form !== null,
      disabled: button.hasAttribute("disabled"),
      text: button.textContent,
    }).toEqual({
      form: true,
      disabled: true,
      text: "setting up…",
    });

    resolveAction!({ error: "Webhook setup failed" });

    await waitFor(() => {
      expect(screen.getByText("Webhook setup failed")).toBeInTheDocument();
    });

    expect({
      disabled: button.hasAttribute("disabled"),
      text: button.textContent,
    }).toEqual({
      disabled: false,
      text: "set up",
    });
  });
});
