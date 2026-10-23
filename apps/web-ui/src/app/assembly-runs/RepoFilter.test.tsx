// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import RepoFilter from "./RepoFilter";

describe("RepoFilter", () => {
  it("navigates to /assembly-runs?repo=re-cinq/lore&status=running when re-cinq/lore is picked at status running", () => {
    render(
      <RepoFilter
        repos={["re-cinq/floor", "re-cinq/lore"]}
        activeStatus="running"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Repository" }), {
      target: { value: "re-cinq/lore" },
    });

    expect(push).toHaveBeenCalledWith(
      "/assembly-runs?repo=re-cinq%2Flore&status=running",
    );
  });

  it("navigates to /assembly-runs?status=failed when All repos is picked at status failed", () => {
    render(
      <RepoFilter
        repos={["re-cinq/lore"]}
        activeRepo="re-cinq/lore"
        activeStatus="failed"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Repository" }), {
      target: { value: "" },
    });

    expect(push).toHaveBeenLastCalledWith("/assembly-runs?status=failed");
  });

  it("shows re-cinq/lore in the select as soon as it is picked, before the page for it arrives", () => {
    render(<RepoFilter repos={["re-cinq/floor", "re-cinq/lore"]} />);

    const select = screen.getByRole("combobox", { name: "Repository" });

    fireEvent.change(select, { target: { value: "re-cinq/lore" } });

    expect((select as HTMLSelectElement).value).toBe("re-cinq/lore");
  });
});
