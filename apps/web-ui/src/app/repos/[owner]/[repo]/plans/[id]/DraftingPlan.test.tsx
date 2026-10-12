// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import DraftingPlan from "./DraftingPlan";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("DraftingPlan", () => {
  it("says the agent is writing the plan instead of showing the draft it will replace", () => {
    render(<DraftingPlan />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "The planning agent is writing this plan",
    );
  });

  it("reloads the page every 5 seconds until the draft is written", () => {
    vi.useFakeTimers();
    render(<DraftingPlan />);

    act(() => vi.advanceTimersByTime(15_000));
    vi.useRealTimers();

    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
