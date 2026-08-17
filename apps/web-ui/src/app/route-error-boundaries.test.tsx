// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AppError from "./error";
import GlobalError from "./global-error";
import AssemblyLinesError from "./assembly-runs/error";
import RepoError from "./repos/[owner]/[repo]/error";

const boundaries: Array<
  [string, React.ComponentType<{ error: Error; reset: () => void }>]
> = [
  ["app", AppError],
  ["assembly-runs", AssemblyLinesError],
  ["repo", RepoError],
];

describe("route error boundaries", () => {
  it.each(boundaries)(
    "renders the RouteError fallback for the %s boundary",
    (_name, Boundary) => {
      render(<Boundary error={new Error("boom")} reset={vi.fn()} />);
      const alert = screen.getByRole("alert");

      expect(within(alert).getByText("boom")).toBeInTheDocument();
    },
  );

  it("wires the reset callback through to the Try again button", () => {
    const reset = vi.fn();

    render(<AppError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("renders the RouteError fallback for the global-error boundary", () => {
    render(<GlobalError error={new Error("fatal")} reset={vi.fn()} />);

    expect(screen.getByText("fatal")).toBeInTheDocument();
  });
});
