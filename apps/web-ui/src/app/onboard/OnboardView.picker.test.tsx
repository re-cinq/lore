// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OnboardView from "./OnboardView";

vi.mock("@/components/Icon", () => ({ default: () => <span /> }));

const noop = vi.fn().mockResolvedValue(null);

describe("OnboardView repo picker", () => {
  it("renders a combobox labeled Repository", () => {
    render(<OnboardView onboarded={[]} onboardRepoAction={noop} />);
    expect(
      screen.getByRole("combobox", { name: /repository/i }),
    ).toBeInTheDocument();
  });
});
