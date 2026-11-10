// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";

import { DeleteSkillButton } from "./DeleteSkillButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

const openDialog = () =>
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

const confirmButton = () =>
  screen.getByRole("button", { name: "Delete skill" });

describe("DeleteSkillButton", () => {
  it("keeps Delete skill disabled for tdd until tdd is typed", () => {
    render(<DeleteSkillButton name="tdd" remove={async () => ({})} />);

    openDialog();
    const enabledBefore = !confirmButton().hasAttribute("disabled");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tdd" } });

    expect({
      enabledBefore,
      enabledAfter: !confirmButton().hasAttribute("disabled"),
    }).toEqual({ enabledBefore: false, enabledAfter: true });
  });

  it("runs the removal once and shows the refusal when the API refuses to delete tdd", async () => {
    const remove = vi.fn(async () => ({ error: "database unavailable" }));

    render(<DeleteSkillButton name="tdd" remove={remove} />);
    openDialog();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tdd" } });
    await act(async () => {
      fireEvent.click(confirmButton());
    });

    expect({
      calls: remove.mock.calls.length,
      alert: screen.getByRole("alert").textContent,
    }).toEqual({ calls: 1, alert: "database unavailable" });
  });
});
