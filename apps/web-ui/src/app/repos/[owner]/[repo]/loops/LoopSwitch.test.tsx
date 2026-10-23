// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import LoopSwitch from "./LoopSwitch";

const toggle = vi.fn(async () => null);

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

  it("shows On the moment Off is clicked, while the write and the refresh are still on their way", async () => {
    const write = vi.fn(() => new Promise<string | null>(() => {}));
    const { getByRole } = render(
      <LoopSwitch {...triageSwitch} toggle={write} enabled={false} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Off/ }));
    });

    const button = getByRole("button", { name: /On/ });

    expect({
      label: button.textContent,
      disabled: (button as HTMLButtonElement).disabled,
      writes: write.mock.calls,
    }).toEqual({ label: "On", disabled: true, writes: [[{ enabled: true }]] });
  });

  it("falls back to Off and says the switch failed when the write cannot be sent", async () => {
    const refused = vi.fn(async (): Promise<string | null> => {
      throw new Error("network");
    });
    const { getByRole } = render(
      <LoopSwitch {...triageSwitch} toggle={refused} enabled={false} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Off/ }));
    });

    expect({
      label: getByRole("button").textContent,
      alert: getByRole("alert").textContent,
    }).toEqual({ label: "Off", alert: "Could not switch it; try again." });
  });

  it("falls back to Off and shows lore-api's reason when it refuses the switch", async () => {
    const refused = vi.fn(async () => "repo not found: re-cinq/lore");
    const { getByRole } = render(
      <LoopSwitch {...triageSwitch} toggle={refused} enabled={false} />,
    );

    await act(async () => {
      fireEvent.click(getByRole("button", { name: /Off/ }));
    });

    expect({
      label: getByRole("button").textContent,
      alert: getByRole("alert").textContent,
    }).toEqual({
      label: "Off",
      alert: "repo not found: re-cinq/lore",
    });
  });
});
