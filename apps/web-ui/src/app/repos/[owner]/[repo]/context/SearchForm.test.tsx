// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SearchForm from "./SearchForm";

const submitForm = () =>
  fireEvent.submit(screen.getByLabelText("Search context").closest("form")!);

describe("SearchForm", () => {
  beforeEach(() => push.mockClear());

  it("seeds the input from the active query", () => {
    render(<SearchForm basePath="/repos/o/r/context" q="foo" />);
    expect(screen.getByLabelText("Search context")).toHaveValue("foo");
  });

  it("navigates to the base path with the typed query on submit", () => {
    render(<SearchForm basePath="/context" />);
    fireEvent.change(screen.getByLabelText("Search context"), {
      target: { value: "hello" },
    });
    submitForm();
    expect(push).toHaveBeenCalledWith("/context?q=hello");
  });

  it("preserves the active type filter when searching", () => {
    render(<SearchForm basePath="/context" activeType="doc" />);
    fireEvent.change(screen.getByLabelText("Search context"), {
      target: { value: "x" },
    });
    submitForm();
    expect(push).toHaveBeenCalledWith("/context?q=x&type=doc");
  });

  it("navigates to the bare base path when the query is cleared", () => {
    render(<SearchForm basePath="/context" q="old" />);
    fireEvent.change(screen.getByLabelText("Search context"), {
      target: { value: "" },
    });
    submitForm();
    expect(push).toHaveBeenCalledWith("/context");
  });
});
