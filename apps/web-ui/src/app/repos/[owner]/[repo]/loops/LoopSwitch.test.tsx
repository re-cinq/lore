// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import LoopSwitch from "./LoopSwitch";

const toggle = vi.fn(async () => {});

const triageSwitch = {
  label: "Issue triage",
  description: "Reads every issue labelled triage: needs-triage.",
  toggle,
};

const renderOn = () => render(<LoopSwitch {...triageSwitch} enabled />);
const renderOff = () =>
  render(<LoopSwitch {...triageSwitch} enabled={false} />);

describe("LoopSwitch", () => {
  it("names the loop and shows a green On button while it is switched on", () => {
    const { getByRole, getByTestId } = renderOn();

    expect({
      heading: getByRole("heading", { name: "Issue triage" }).textContent,
      button: getByRole("button", { name: /On/ }).title,
      dot: getByTestId("state-dot").dataset.enabled,
    }).toEqual({
      heading: "Issue triage",
      button: "Switch Issue triage off",
      dot: "true",
    });
  });

  it("shows a red Off button while it is switched off and flips it on through the bound action", () => {
    const { getByRole, getByTestId } = renderOff();

    expect(getByTestId("state-dot").dataset.enabled).toBe("false");
    fireEvent.click(getByRole("button", { name: /Off/ }));

    expect(toggle).toHaveBeenCalledWith({ enabled: true });
  });
});
