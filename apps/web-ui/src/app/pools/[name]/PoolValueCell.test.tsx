// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, within, act } from "@testing-library/react";
import { PoolValueCell } from "./PoolValueCell";

const renderCell = (value: string) => {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <PoolValueCell value={value} />
        </tr>
      </tbody>
    </table>,
  );
  return within(container.querySelector("td")!);
};

const stubClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PoolValueCell", () => {
  it("shows the full value and only a Copy button when short", () => {
    const cell = renderCell("short value");
    expect(cell.getByText("short value")).toBeInTheDocument();
    expect(cell.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(cell.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("truncates a long value and toggles expand/collapse", () => {
    const long = "x".repeat(250);
    const cell = renderCell(long);
    expect(cell.getByText(`${"x".repeat(200)}…`)).toBeInTheDocument();

    fireEvent.click(cell.getByRole("button", { name: "Show more" }));
    expect(cell.getByText(long)).toBeInTheDocument();

    fireEvent.click(cell.getByRole("button", { name: "Show less" }));
    expect(cell.getByText(`${"x".repeat(200)}…`)).toBeInTheDocument();
  });

  it("flips Copy to Copied and back after 1.5s", async () => {
    vi.useFakeTimers();
    const writeText = stubClipboard();
    const cell = renderCell("some value");

    fireEvent.click(cell.getByRole("button", { name: "Copy" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("some value");
    expect(cell.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(cell.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("keeps Copied visible 1.5s after the latest click when copies overlap", async () => {
    vi.useFakeTimers();
    stubClipboard();
    const cell = renderCell("some value");
    const button = () =>
      cell.getByRole("button", { name: /^Cop(y|ied)$/ }) as HTMLButtonElement;

    fireEvent.click(button());
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    fireEvent.click(button());
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(button().textContent).toEqual("Copied");

    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(button().textContent).toEqual("Copy");
  });
});
