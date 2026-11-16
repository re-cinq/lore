// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { bleedOf, useBleedToScroller } from "./use-bleed-to-scroller";

describe("bleedOf", () => {
  it("reaches 40px left and 56px right of a bar in a scroller padded 40px and 56px", () => {
    expect(
      bleedOf(
        { left: 296, right: 1384 },
        { left: 256, clientLeft: 0, clientWidth: 1184 },
      ),
    ).toEqual({ left: 40, right: 56 });
  });
});

function Bar() {
  const ref = useRef<HTMLDivElement>(null);

  useBleedToScroller(ref);

  return (
    <div
      data-testid="scroller"
      ref={(scroller) => scroller?.style.setProperty("overflow-y", "auto")}
    >
      <div ref={ref} data-testid="bar" />
    </div>
  );
}

describe("useBleedToScroller", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets the bar's bleed to its scroller's padding once observed", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly measure: () => void) {}
        observe() {
          this.measure();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return (
          this.dataset.testid === "bar"
            ? { left: 296, right: 1384 }
            : { left: 256, right: 1440 }
        ) as DOMRect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1184);

    const { getByTestId } = render(<Bar />);
    const toolbar = getByTestId("bar");

    expect({
      left: toolbar.style.getPropertyValue("--bleed-left"),
      right: toolbar.style.getPropertyValue("--bleed-right"),
    }).toEqual({ left: "40px", right: "56px" });
  });
});
