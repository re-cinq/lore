// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocListControls from "./DocListControls";

describe("DocListControls", () => {
  it("reports typed search text through onQueryChange", () => {
    const onQueryChange = vi.fn();

    render(<DocListControls query="" onQueryChange={onQueryChange} />);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "auth" },
    });

    expect(onQueryChange).toHaveBeenCalledWith("auth");
  });

  it("renders the sort select only when onSortChange is provided", () => {
    const { rerender } = render(
      <DocListControls query="" onQueryChange={vi.fn()} />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();

    rerender(
      <DocListControls
        query=""
        onQueryChange={vi.fn()}
        sort="path"
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("reports the picked sort order through onSortChange", () => {
    const onSortChange = vi.fn();

    render(
      <DocListControls
        query=""
        onQueryChange={vi.fn()}
        sort="path"
        onSortChange={onSortChange}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "status" },
    });

    expect(onSortChange).toHaveBeenCalledWith("status");
  });
});
