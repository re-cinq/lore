// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import CopyButton from "./CopyButton";

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CopyButton", () => {
  it("renders the Copy label before any interaction", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("writes the given text to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    stubClipboard(writeText);
    render(<CopyButton text="payload-to-copy" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("payload-to-copy"),
    );
  });

  it("swaps the label to Copied after a successful clipboard write", async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reverts the label to Copy 1500ms after a successful copy", async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));
    // Flush the awaited writeText microtask so setCopied(true) + setTimeout register.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button")).toHaveTextContent("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button")).toHaveTextContent("Copy");
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("keeps the Copy label when the clipboard write rejects", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(new Error("clipboard unavailable"));

    stubClipboard(writeText);
    render(<CopyButton text="hello" />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button")).toHaveTextContent("Copy");
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
