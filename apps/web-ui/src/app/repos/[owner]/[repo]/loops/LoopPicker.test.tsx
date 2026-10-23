// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PendingMark } from "./LinkPending";
import LoopPicker from "./LoopPicker";

const loops = [
  {
    key: "implementation" as const,
    label: "Implementation loop",
    description: "",
    enabled: false,
  },
  {
    key: "triage" as const,
    label: "Issue triage",
    description: "",
    enabled: true,
  },
];

describe("LoopPicker", () => {
  it("renders All then one pill per loop linking to its ?loop=, marking the selected one current, with each loop's state dot", () => {
    const { getAllByRole, getAllByTestId } = render(
      <LoopPicker
        loops={loops}
        selected="triage"
        base="/repos/re-cinq/lore/loops"
      />,
    );

    expect(
      getAllByRole("link").map((a) => ({
        text: a.textContent,
        href: a.getAttribute("href"),
        current: a.getAttribute("aria-current"),
      })),
    ).toEqual([
      {
        text: "All",
        href: "/repos/re-cinq/lore/loops?loop=all",
        current: null,
      },
      {
        text: "Implementation loop",
        href: "/repos/re-cinq/lore/loops?loop=implementation",
        current: null,
      },
      {
        text: "Issue triage",
        href: "/repos/re-cinq/lore/loops?loop=triage",
        current: "page",
      },
    ]);
    expect(getAllByTestId("state-dot").map((d) => d.dataset.enabled)).toEqual([
      "false",
      "true",
    ]);
  });

  it("marks All current when all loops are shown", () => {
    const { getByRole } = render(
      <LoopPicker
        loops={loops}
        selected="all"
        base="/repos/re-cinq/lore/loops"
      />,
    );

    expect(getByRole("link", { current: "page" }).textContent).toBe("All");
  });
});

describe("PendingMark", () => {
  it("shows a spinner named Loading while a pill's page is on its way, and nothing otherwise", () => {
    const pending = render(<PendingMark pending />);
    const pendingName = pending.getByRole("status").getAttribute("aria-label");

    pending.unmount();

    const idle = render(<PendingMark pending={false} />);

    expect({ pendingName, idle: idle.queryByRole("status") }).toEqual({
      pendingName: "Loading",
      idle: null,
    });
  });
});
