// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RouteError from "./RouteError";

describe("RouteError", () => {
  it("renders the error message", () => {
    render(
      <RouteError error={new Error("database unavailable")} reset={() => {}} />,
    );
    expect(screen.getByText("database unavailable")).toBeInTheDocument();
  });

  it("falls back to a generic message when the error has none", () => {
    render(<RouteError error={new Error("")} reset={() => {}} />);
    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
  });

  it("calls reset when the retry button is clicked", () => {
    const reset = vi.fn();

    render(<RouteError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
