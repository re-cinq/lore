// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PresenceDot from "./PresenceDot";

describe("PresenceDot", () => {
  it("is yellow and named for west still holding an older version of loop-tdd", () => {
    const { getByTestId } = render(
      <PresenceDot
        presence={{
          state: "some",
          latest: "h2",
          clusters: [
            { id: "east", hash: "h2", current: true },
            { id: "west", hash: "h1", current: false },
          ],
        }}
      />,
    );
    const dot = getByTestId("presence-dot");

    expect({ state: dot.dataset.state, name: dot.getAttribute("aria-label") }).toEqual({
      state: "some",
      name: "Not live everywhere yet. Latest: east. Older version: west",
    });
  });
});
