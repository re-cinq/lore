// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import InfiniteEvents from "./InfiniteEvents";

class StubIntersectionObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});

describe("InfiniteEvents", () => {
  it("renders a pager sentinel row when a further page exists", () => {
    render(
      <table>
        <tbody>
          <InfiniteEvents
            owner="o"
            repo="r"
            initialOffset={50}
            hasMore={true}
          />
        </tbody>
      </table>,
    );

    expect(screen.queryByText(/reached the end/)).toBeNull();
  });

  it("renders nothing when there is no further page and no events loaded yet", () => {
    const { container } = render(
      <table>
        <tbody>
          <InfiniteEvents
            owner="o"
            repo="r"
            initialOffset={50}
            hasMore={false}
          />
        </tbody>
      </table>,
    );

    expect(container.querySelector("tbody")?.children.length).toBe(0);
  });
});
