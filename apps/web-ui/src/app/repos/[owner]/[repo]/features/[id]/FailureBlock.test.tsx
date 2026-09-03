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

  it("names no cause when nothing recorded a reason, and points at the transcript", () => {
    render(
      <FailureBlock
        iteration={1}
        failureReason={null}
        run={{ id: "run-1", reason: null }}
        pending={false}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/recorded no reason/)).toBeTruthy();
    expect(screen.getByText(/one cause among several/)).toBeTruthy();
  });

  it("shows what the author submitted, so a failed round does not swallow it", () => {
    render(
      <FailureBlock
        iteration={2}
        failureReason="node analyze failed"
        answers={{
          sections: {
            "Data queries": {
              comment: "use http + a refresh event",
              direction: "refine",
            },
          },
          questions: {},
          free_form: "",
        }}
        pending={false}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText(/use http \+ a refresh event/)).toBeTruthy();
    expect(screen.getByText(/Data queries/)).toBeTruthy();
  });

  it("shows no input section for a round the author submitted none for", () => {
    render(
      <FailureBlock
        iteration={1}
        failureReason="node analyze failed"
        answers={null}
        pending={false}
        onRetry={() => {}}
      />,
    );

    expect(screen.queryByText(/Your input for this round/)).toBeNull();
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
    ).toHaveAttribute("href", "/assembly-runs/run-42");
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
