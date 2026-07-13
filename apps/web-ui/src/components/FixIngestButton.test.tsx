// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FixIngestButton from "./FixIngestButton";

describe("FixIngestButton", () => {
  it("renders nothing when no repos are misaligned", () => {
    const { container } = render(
      <FixIngestButton repos={[]} action={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the misaligned count and runs the action on click", async () => {
    const action = vi.fn().mockResolvedValue({ opened: 2, prs: ["a", "b"] });
    render(
      <FixIngestButton repos={["re-cinq/a", "re-cinq/b"]} action={action} />,
    );

    const button = screen.getByRole("button", {
      name: "⚠ Fix ingest workflow (2)",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(["re-cinq/a", "re-cinq/b"]),
    );
    await screen.findByRole("button", { name: "opened 2 PRs" });
  });

  it("uses the singular PR label when one repo is fixed", async () => {
    const action = vi.fn().mockResolvedValue({ opened: 1, prs: ["a"] });
    render(<FixIngestButton repos={["re-cinq/a"]} action={action} />);

    fireEvent.click(
      screen.getByRole("button", { name: "⚠ Fix ingest workflow (1)" }),
    );

    await screen.findByRole("button", { name: "opened 1 PR" });
  });
});
