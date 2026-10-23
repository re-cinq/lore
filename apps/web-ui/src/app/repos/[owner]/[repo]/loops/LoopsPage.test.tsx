// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/loops", () => ({ getRepoLoops: vi.fn() }));
vi.mock("./actions", () => ({ switchLoopAction: vi.fn() }));
vi.mock("./implementation/ImplementationLoopBody", () => ({
  default: ({ fullName }: { fullName: string }) => (
    <div data-testid="implementation-body">{fullName}</div>
  ),
}));
vi.mock("./triage/TriageBody", () => ({
  default: ({ fullName }: { fullName: string }) => (
    <div data-testid="triage-body">{fullName}</div>
  ),
}));

import { getRepoLoops } from "@/lib/api/loops";
import LoopsPage from "./LoopsPage";

const params = Promise.resolve({ owner: "re-cinq", repo: "lore" });
const loops = [
  {
    key: "implementation",
    label: "Implementation loop",
    description: "Works the backlog.",
    enabled: false,
  },
  {
    key: "triage",
    label: "Issue triage",
    description: "Triages issues.",
    enabled: true,
  },
];

function page(loop?: string) {
  return LoopsPage({ params, searchParams: Promise.resolve({ loop }) });
}

describe("LoopsPage", () => {
  beforeEach(() => {
    vi.mocked(getRepoLoops).mockResolvedValue({
      status: "ok",
      data: { loops },
    } as never);
  });

  it("opens on the implementation loop when the query names none, with its switch and body", async () => {
    render(await page());

    expect({
      heading: screen.getByRole("heading", { name: "Implementation loop" })
        .textContent,
      button: screen.getByRole("button", { name: /Off/ }).title,
      body: screen.getByTestId("implementation-body").textContent,
      pills: screen.getAllByRole("link").length,
    }).toEqual({
      heading: "Implementation loop",
      button: "Switch Implementation loop on",
      body: "re-cinq/lore",
      pills: 2,
    });
  });

  it("?loop=triage shows the triage switch, on, and the triage body", async () => {
    render(await page("triage"));

    expect({
      heading: screen.getByRole("heading", { name: "Issue triage" })
        .textContent,
      button: screen.getByRole("button", { name: /On/ }).textContent,
      body: screen.getByTestId("triage-body").textContent,
    }).toEqual({
      heading: "Issue triage",
      button: "On",
      body: "re-cinq/lore",
    });
  });

  it("a loop the repository does not have is a 404", async () => {
    await expect(page("review")).rejects.toThrow(/404/);
  });

  it("names the API error when the loops cannot be read", async () => {
    vi.mocked(getRepoLoops).mockResolvedValue({
      status: "error",
      message: "HTTP 502",
    } as never);

    render(await page());

    expect(
      screen.getByText(/Could not load the repository's loops \(HTTP 502\)/),
    ).toBeTruthy();
  });
});
