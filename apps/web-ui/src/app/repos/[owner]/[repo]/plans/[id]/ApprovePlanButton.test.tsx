// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import ApprovePlanButton from "./ApprovePlanButton";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ApprovePlanButton", () => {
  it("approves the plan only after the confirmation popup, then refreshes", async () => {
    const approve = vi.fn(async () => ({}));

    render(<ApprovePlanButton canApprove approve={approve} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    const asked = approve.mock.calls.length;

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Approve",
        }),
      );
    });

    expect({
      asked,
      approved: approve.mock.calls.length,
      refreshed: refresh.mock.calls.length,
    }).toEqual({
      asked: 0,
      approved: 1,
      refreshed: 1,
    });
  });

  it("shows 'Plan is not ready' from lore-api and keeps the page as it is", async () => {
    refresh.mockClear();

    render(
      <ApprovePlanButton
        canApprove
        approve={async () => ({ error: "Plan is not ready" })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    expect({
      alert: screen.getByRole("alert").textContent,
      refreshed: refresh.mock.calls.length,
    }).toEqual({
      alert: "Plan is not ready",
      refreshed: 0,
    });
  });

  it("disables Approve plan while the outline lists what the plan still needs", () => {
    render(<ApprovePlanButton canApprove={false} approve={async () => ({})} />);

    expect(screen.getByRole("button", { name: "Approve plan" })).toBeDisabled();
  });
});
