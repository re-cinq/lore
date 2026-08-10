// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FailureBlock from "./FailureBlock";

const noop = () => {};

describe("FailureBlock", () => {
  it("shows the task's failure reason instead of the ANTHROPIC_API_KEY guess", () => {
    render(
      <FailureBlock
        iteration={3}
        failureReason={
          "fatal: repository 'https://github.com/re-cinq/lore.git/' not found"
        }
        pending={false}
        onRetry={noop}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "fatal: repository 'https://github.com/re-cinq/lore.git/' not found",
    );
    expect(screen.queryByText(/ANTHROPIC_API_KEY/)).toBeNull();
  });

  it("falls back to the line's reason when the task recorded none", () => {
    render(
      <FailureBlock
        iteration={3}
        failureReason={null}
        run={{
          id: "ae7918b1-4baa-41fc-8b34-deb1be4cddf9",
          reason: 'node "analyze" failed',
        }}
        pending={false}
        onRetry={noop}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      'node "analyze" failed',
    );
    expect(screen.queryByText(/ANTHROPIC_API_KEY/)).toBeNull();
  });

  it("keeps the model-unreachable hint when nothing recorded a reason", () => {
    render(
      <FailureBlock
        iteration={1}
        failureReason={null}
        run={{ id: "run-1", reason: null }}
        pending={false}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeTruthy();
  });

  it("links to the run transcript when the round has a run", () => {
    render(
      <FailureBlock
        iteration={2}
        failureReason="boom"
        run={{ id: "run-42", reason: null }}
        pending={false}
        onRetry={noop}
      />,
    );

    expect(
      screen.getByRole("link", { name: /full run transcript/i }),
    ).toHaveAttribute("href", "/assembly-lines/run-42");
  });

  it("omits the transcript link for a round with no run", () => {
    render(
      <FailureBlock
        iteration={2}
        failureReason="boom"
        pending={false}
        onRetry={noop}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /full run transcript/i }),
    ).toBeNull();
  });

  it("disables the retry button while a retry is in flight", () => {
    render(
      <FailureBlock
        iteration={2}
        failureReason="boom"
        pending
        onRetry={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  });
});
