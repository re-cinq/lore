// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import PlanBlockAnchor from "./PlanBlockAnchor";

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView() {
    scrolled.push((this as HTMLElement).dataset.id ?? "");
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

function editorRenders(blockId: string): HTMLElement {
  const block = document.createElement("div");

  block.dataset.id = blockId;
  document.body.append(block);

  return block;
}

describe("PlanBlockAnchor", () => {
  it("scrolls to block b-7 and marks it once the editor renders it after the page opened at #b-7", async () => {
    window.history.replaceState(null, "", "/repos/o/r/plans/p1#b-7");
    render(<PlanBlockAnchor />);

    const block = editorRenders("b-7");

    await waitFor(() =>
      expect({ scrolled, marked: block.className !== "" }).toEqual({
        scrolled: ["b-7"],
        marked: true,
      }),
    );
  });

  it("scrolls nowhere when the page opened without a block in its address", async () => {
    render(<PlanBlockAnchor />);
    editorRenders("b-7");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrolled).toEqual([]);
  });

  it("scrolls to block b-7 when the editor rendered it before the page looked", async () => {
    window.history.replaceState(null, "", "/repos/o/r/plans/p1#b-7");
    editorRenders("b-7");

    render(<PlanBlockAnchor />);

    await waitFor(() => expect(scrolled).toEqual(["b-7"]));
  });

  it("renders without scrolling when the address ends in a malformed escape like #%E0%A4%A", async () => {
    window.history.replaceState(null, "", "/repos/o/r/plans/p1#%E0%A4%A");

    render(<PlanBlockAnchor />);
    editorRenders("b-7");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scrolled).toEqual([]);
  });
});
