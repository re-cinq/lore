// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/api/backlog", () => ({
  getImplementationLoop: vi.fn(),
  setImplementationLoopEnabled: vi.fn(),
}));
vi.mock("./actions", () => ({ toggleImplementationLoopAction: vi.fn() }));

import { getImplementationLoop } from "@/lib/api/backlog";
import ImplementationLoopPage from "./ImplementationLoopPage";

const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });

describe("ImplementationLoopPage", () => {
  it("renders the view from an ok read", async () => {
    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "ok",
      data: {
        enabled: true,
        current: null,
        current_run_id: null,
        next: [],
        recent: [],
      },
    } as never);

    const { getByText } = render(await ImplementationLoopPage({ params }));

    expect(getByText("Disable loop")).toBeTruthy();
  });

  it("says what happened on an API failure instead of a disabled-empty page", async () => {
    vi.mocked(getImplementationLoop).mockResolvedValue({
      status: "error",
      message: "boom",
    } as never);

    const { getByText } = render(await ImplementationLoopPage({ params }));

    expect(getByText(/Could not load the backlog state/)).toBeTruthy();
    expect(getByText(/boom/)).toBeTruthy();
  });
});
