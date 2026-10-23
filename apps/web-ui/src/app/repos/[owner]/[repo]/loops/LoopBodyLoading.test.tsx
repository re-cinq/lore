// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LoopBodyLoading from "./LoopBodyLoading";

describe("LoopBodyLoading", () => {
  it("is a status named Loading Issue triage while the triage lists are read", () => {
    const { getByRole } = render(<LoopBodyLoading label="Issue triage" />);

    expect(getByRole("status").getAttribute("aria-label")).toBe(
      "Loading Issue triage",
    );
  });
});
