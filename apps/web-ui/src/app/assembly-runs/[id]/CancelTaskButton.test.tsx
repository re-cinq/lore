// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CancelTaskButton } from "./CancelTaskButton";

describe("CancelTaskButton", () => {
  it("shows only the trigger and no submit form before confirming", () => {
    const { container } = render(<CancelTaskButton taskId="t1" />);

    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm cancel" })).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("reveals a confirm form posting to the cancel endpoint after the trigger is clicked", () => {
    const { container } = render(<CancelTaskButton taskId="t1" />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel Task" }));
    expect(
      screen.getByRole("button", { name: "Confirm cancel" }),
    ).toBeInTheDocument();
    expect(container.querySelector("form")).toHaveAttribute(
      "action",
      "/api/tasks/t1/cancel",
    );
  });

  it("backs out to the trigger when Keep task is clicked", () => {
    render(<CancelTaskButton taskId="t1" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel Task" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep task" }));
    expect(screen.queryByRole("button", { name: "Confirm cancel" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
  });
});
