// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OnboardView from "./OnboardView";

vi.mock("@/components/Icon", () => ({ default: () => <span /> }));

const action = vi.fn().mockResolvedValue(null);

describe("OnboardView", () => {
  it("renders the heading and intro copy", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Add a repository" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Lore opens a PR on the target repo/),
    ).toBeInTheDocument();
  });

  it("lists each already-onboarded repo as a pill when present", () => {
    render(
      <OnboardView
        onboarded={[
          { full_name: "re-cinq/lore" },
          { full_name: "re-cinq/other" },
        ]}
        onboardRepoAction={action}
      />,
    );
    expect(screen.getByText(/Already onboarded:/)).toHaveTextContent(
      "Already onboarded:re-cinq/lorere-cinq/other",
    );
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
      screen.getByRole("button", { name: "Open onboarding PR" }),
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
    fireEvent.click(screen.getByRole("button", { name: "Open onboarding PR" }));

    expect(
      await screen.findByText("re-cinq/nope is already onboarded."),
    ).toHaveAttribute("role", "alert");
    await waitFor(() => expect(input.value).toBe("re-cinq/nope"));
  });

  it("lists what the onboarding PR adds", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    const fileCards = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent);

    expect(fileCards).toEqual([
      "CLAUDE.md, AGENTS.mdConventions and context for agents",
      "PR templateWhat every pull request describes",
      "CI workflowsIngest and test tracing on push to main",
    ]);
  });

  it("renders no alert before any submit", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={action} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
