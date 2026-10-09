// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResizeHandle } from "./ResizeHandle";

const bounds = { min: 280, max: 720, default: 380 };

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
});

function renderHandle(onResize = vi.fn()) {
  render(<ResizeHandle width={380} bounds={bounds} onResize={onResize} />);

  return { handle: screen.getByRole("separator"), onResize };
}

describe("ResizeHandle", () => {
  it("resizes a 380 panel to 430 when the pointer drags 50px left", () => {
    const { handle, onResize } = renderHandle();

    fireEvent.pointerDown(handle, { clientX: 800, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 750, pointerId: 1 });

    expect(onResize).toHaveBeenCalledWith(430);
  });

  it("ignores pointer moves after the pointer is released", () => {
    const { handle, onResize } = renderHandle();

    fireEvent.pointerDown(handle, { clientX: 800, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });

    expect(onResize).not.toHaveBeenCalled();
  });

  it("narrows a 380 panel to 364 on ArrowRight", () => {
    const { handle, onResize } = renderHandle();

    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(onResize).toHaveBeenCalledWith(364);
  });

  it("leaves the width alone on an unrelated key", () => {
    const { handle, onResize } = renderHandle();

    fireEvent.keyDown(handle, { key: "Enter" });

    expect(onResize).not.toHaveBeenCalled();
  });
});
