// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OnboardView from "./OnboardView";

const action = vi.fn().mockResolvedValue(null);

describe("OnboardView", () => {
  it("renders the heading and intro copy", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Add Repository" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Onboard a repository to Lore. This will create a PR on the target repo/,
      ),
    ).toBeInTheDocument();
  });

  it("lists already-onboarded repos joined by comma when present", () => {
    render(
      <OnboardView
        onboarded={[
          { full_name: "re-cinq/lore" },
          { full_name: "re-cinq/other" },
        ]}
        onboardRepoAction={action}
      />,
    );
    expect(
      screen.getByText(/Already onboarded: re-cinq\/lore, re-cinq\/other/),
    ).toBeInTheDocument();
  });

  it("omits the already-onboarded hint when the list is empty", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    expect(screen.queryByText(/Already onboarded:/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/The GitHub App must have access to this repo\./),
    ).toBeInTheDocument();
  });

  it("wires the onboard form with the full_name input and submit button", () => {
    const { container } = render(
      <OnboardView onboarded={[]} onboardRepoAction={action} />,
    );

    expect(
      screen.getByRole("button", { name: "Onboard Repository" }),
    ).toBeInTheDocument();
    const input = container.querySelector('input[name="full_name"]');

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("required");
    expect(input).toHaveAttribute("placeholder", "re-cinq/my-service");
    expect(input).toHaveAttribute("pattern", "[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+");
  });

  it("shows the action error and keeps the typed repo name after a failed submit", async () => {
    const failing = vi.fn().mockResolvedValue({
      error: "re-cinq/nope is already onboarded.",
      fullName: "re-cinq/nope",
    });
    const { container } = render(
      <OnboardView onboarded={[]} onboardRepoAction={failing} />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[name="full_name"]',
    )!;

    fireEvent.change(input, { target: { value: "re-cinq/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Onboard Repository" }));

    expect(
      await screen.findByText("re-cinq/nope is already onboarded."),
    ).toHaveAttribute("role", "alert");
    await waitFor(() => expect(input.value).toBe("re-cinq/nope"));
  });

  it("renders no alert before any submit", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
