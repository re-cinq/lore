// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpendTrendChart } from "./SpendTrendChart";

const usd = (n: number) =>
  Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });

const daily = [
  { bucket_date: "2026-09-01", calls: 32, cost_usd: 14.24 },
  { bucket_date: "2026-08-31", calls: 20, cost_usd: 6.75 },
  { bucket_date: "2026-08-30", calls: 10, cost_usd: 0 },
];

describe("SpendTrendChart", () => {
  it("draws one bar per day", () => {
    const { container } = render(<SpendTrendChart daily={daily} />);

    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("labels each day with its cost", () => {
    render(<SpendTrendChart daily={daily} />);

    expect(screen.getByText(usd(14.24))).toBeInTheDocument();
    expect(screen.getByText(usd(6.75))).toBeInTheDocument();
  });

  it("labels each bar with its date, oldest first", () => {
    render(<SpendTrendChart daily={daily} />);
    const dates = screen
      .getAllByText(/^\d{2}-\d{2}$/)
      .map((e) => e.textContent);

    expect(dates).toEqual(["08-30", "08-31", "09-01"]);
  });

  it("carries an accessible label naming the peak day", () => {
    render(<SpendTrendChart daily={daily} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /daily llm cost/i,
    );
  });

  it("shows an empty note and no chart when there is no daily spend", () => {
    render(<SpendTrendChart daily={[]} />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/no daily spend/i)).toBeInTheDocument();
  });
});
