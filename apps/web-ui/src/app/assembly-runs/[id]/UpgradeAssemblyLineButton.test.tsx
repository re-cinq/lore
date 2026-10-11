// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { UpgradeAssemblyLineButton } from "./UpgradeAssemblyLineButton";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

function answering(status: number, body: object) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

async function clickUpgrade() {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Upgrade assembly line" }),
    );
  });
}

describe("UpgradeAssemblyLineButton", () => {
  it("posts to the old-run upgrade proxy and opens the run the floor started", async () => {
    const fetchMock = answering(201, { run_id: "new-run" });

    render(<UpgradeAssemblyLineButton runId="old-run" />);
    await clickUpgrade();

    expect({
      url: fetchMock.mock.calls[0][0],
      method: fetchMock.mock.calls[0][1].method,
      opened: push.mock.calls,
    }).toEqual({
      url: "/api/assembly-runs/old-run/upgrade",
      method: "POST",
      opened: [["/assembly-runs/new-run"]],
    });
  });

  it("shows the refusal beside the button and navigates nowhere on a 409", async () => {
    answering(409, { error: "this run already uses the latest assembly line" });

    render(<UpgradeAssemblyLineButton runId="old-run" />);
    await clickUpgrade();

    expect({
      shown: screen.getByText("this run already uses the latest assembly line"),
      opened: push.mock.calls.length,
    }).toMatchObject({ opened: 0 });
  });

  it("reads a refusal with no message as the status it came with", async () => {
    answering(502, {});

    render(<UpgradeAssemblyLineButton runId="old-run" />);
    await clickUpgrade();

    expect(screen.getByText("upgrade failed (502)")).toBeInTheDocument();
  });
});
