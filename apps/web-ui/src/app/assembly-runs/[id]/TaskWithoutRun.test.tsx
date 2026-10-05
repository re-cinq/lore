// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TaskWithoutRun from "./TaskWithoutRun";

const task = { status: "failed", target_repo: "re-cinq/lore" };

describe("TaskWithoutRun", () => {
  it("says the failed task has no run and why it failed", () => {
    render(
      <TaskWithoutRun
        task={{ ...task, failure_reason: "the floor refused the start" }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "This task has no run" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("the floor refused the start")).toBeInTheDocument();
  });

  it("links the task's repository", () => {
    render(<TaskWithoutRun task={{ ...task, failure_reason: null }} />);

    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
  });

  it("shows no reason for a task that has none", () => {
    const { container } = render(
      <TaskWithoutRun task={{ ...task, failure_reason: null }} />,
    );

    expect(container.querySelector("p")).toBeNull();
  });
});
