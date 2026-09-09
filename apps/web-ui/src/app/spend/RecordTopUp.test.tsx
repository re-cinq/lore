// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecordTopUp from "./RecordTopUp";

const noop = vi.fn().mockResolvedValue({});

describe("RecordTopUp", () => {
  it("opens expanded and asks for the opening balance when the ledger is empty", () => {
    render(<RecordTopUp first recordAction={noop} />);

    expect(screen.getByText("Record the starting balance")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record balance" }),
    ).toBeInTheDocument();
    expect(document.querySelector("details")).toHaveProperty("open", true);
  });

  it("collapses and asks for a top-up once a balance already exists", () => {
    render(<RecordTopUp first={false} recordAction={noop} />);

    expect(screen.getByText("Record a top-up")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record top-up" }),
    ).toBeInTheDocument();
    expect(document.querySelector("details")).toHaveProperty("open", false);
  });

  it("carries a hidden opening-kind field only for the first entry", () => {
    const { container, rerender } = render(
      <RecordTopUp first recordAction={noop} />,
    );

    expect(
      container.querySelector('input[name="kind"][value="opening"]'),
    ).toBeInTheDocument();

    rerender(<RecordTopUp first={false} recordAction={noop} />);

    expect(
      container.querySelector('input[name="kind"]'),
    ).not.toBeInTheDocument();
  });

  it("shows the action error after a failed submit", async () => {
    const failing = vi.fn().mockResolvedValue({
      error: "Enter an amount in dollars, for example 100.",
    });

    render(<RecordTopUp first recordAction={failing} />);
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record balance" }));

    expect(
      await screen.findByText("Enter an amount in dollars, for example 100."),
    ).toBeInTheDocument();
  });

  it("shows the recorded confirmation after a successful submit", async () => {
    const succeeding = vi
      .fn()
      .mockResolvedValue({ recorded: "Recorded $100.00." });

    render(<RecordTopUp first recordAction={succeeding} />);
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record balance" }));

    expect(await screen.findByText("Recorded $100.00.")).toBeInTheDocument();
  });
});
