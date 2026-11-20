// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UpdateSetupButton from "./UpdateSetupButton";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

describe("UpdateSetupButton", () => {
  it("renders nothing when no repos need an update", () => {
    const { container } = render(
      <UpdateSetupButton repos={[]} action={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the repo count and runs the action with the repos on click", async () => {
    const action = vi.fn().mockResolvedValue([
      { repo: "re-cinq/a", status: "started", taskId: "t1" },
      { repo: "re-cinq/b", status: "started", taskId: "t2" },
    ]);

    render(
      <UpdateSetupButton repos={["re-cinq/a", "re-cinq/b"]} action={action} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Update setup (2)" }));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(["re-cinq/a", "re-cinq/b"]),
    );
    await screen.findByRole("button", { name: "started 2" });
  });

  it("links each repo to its run when started or already running", async () => {
    const action = vi.fn().mockResolvedValue([
      { repo: "re-cinq/a", status: "started", taskId: "t1" },
      { repo: "re-cinq/b", status: "running", taskId: "t2" },
    ]);

    render(
      <UpdateSetupButton repos={["re-cinq/a", "re-cinq/b"]} action={action} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Update setup (2)" }));

    expect(
      (
        await screen.findByRole("link", { name: /re-cinq\/a.*started/ })
      ).getAttribute("href"),
    ).toBe("/assembly-runs/t1");
    expect(
      screen
        .getByRole("link", { name: /re-cinq\/b.*already running/ })
        .getAttribute("href"),
    ).toBe("/assembly-runs/t2");
  });

  it("shows the refusal count and each refused repo's reason", async () => {
    const action = vi.fn().mockResolvedValue([
      { repo: "re-cinq/a", status: "started", taskId: "t1" },
      { repo: "re-cinq/b", status: "refused", reason: "not onboarded" },
    ]);

    render(
      <UpdateSetupButton repos={["re-cinq/a", "re-cinq/b"]} action={action} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Update setup (2)" }));

    const button = await screen.findByRole("button", {
      name: "started 1, 1 refused",
    });

    expect(button).toHaveAttribute("title", "re-cinq/b: not onboarded");
    expect(
      screen.getByText(/re-cinq\/b: refused, not onboarded/),
    ).toBeInTheDocument();
  });
});
