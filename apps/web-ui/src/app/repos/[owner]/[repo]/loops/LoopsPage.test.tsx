// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api/loops", () => ({ getRepoLoops: vi.fn() }));
vi.mock("./actions", () => ({
  switchLoopAction: vi.fn(),
  resumeLoopAction: vi.fn(),
}));
vi.mock("./board/LoopBoard", () => ({
  default: ({
    loops,
    fullName,
  }: {
    loops: { key: string }[];
    fullName: string;
  }) => (
    <div data-testid="board">
      {fullName}: {loops.map((l) => l.key).join(",")}
    </div>
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
    paused: null,
  },
  {
    key: "review",
    label: "Code review",
    description: "Reviews pull requests.",
    enabled: false,
    paused: null,
  },
  {
    key: "triage",
    label: "Issue triage",
    description: "Triages issues.",
    enabled: true,
    paused: null,
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

  it("opens on All when the query names none: every loop's switch, then one board of every loop", async () => {
    render(await page());

    expect({
      switches: screen
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
      board: screen.getByTestId("board").textContent,
      current: screen
        .getByRole("link", { current: "page" })
        .getAttribute("href"),
      pills: screen.getAllByRole("link").length,
    }).toEqual({
      switches: ["Implementation loop", "Code review", "Issue triage"],
      board: "re-cinq/lore: implementation,review,triage",
      current: "/repos/re-cinq/lore/loops?loop=all",
      pills: 4,
    });
  });

  it("?loop=implementation shows only the implementation loop's switch, off, its explainer, and the board of that loop", async () => {
    render(await page("implementation"));

    expect({
      switches: screen.getAllByRole("heading", { level: 2 }).length,
      button: screen.getByRole("button", { name: /Off/ }).title,
      explainer: Boolean(screen.getByText(/the label is the whole opt-in/)),
      board: screen.getByTestId("board").textContent,
    }).toEqual({
      switches: 1,
      button: "Switch Implementation loop on",
      explainer: true,
      board: "re-cinq/lore: implementation",
    });
  });

  it("?loop=triage shows the triage switch, on, and the board of triage alone", async () => {
    render(await page("triage"));

    expect({
      heading: screen.getByRole("heading", { name: "Issue triage" })
        .textContent,
      button: screen.getByRole("button", { name: /On/ }).textContent,
      board: screen.getByTestId("board").textContent,
    }).toEqual({
      heading: "Issue triage",
      button: "On",
      board: "re-cinq/lore: triage",
    });
  });

  it("?loop=review shows the code-review switch and the board of code review alone", async () => {
    render(await page("review"));

    expect({
      heading: screen.getByRole("heading", { name: "Code review" }).textContent,
      board: screen.getByTestId("board").textContent,
    }).toEqual({ heading: "Code review", board: "re-cinq/lore: review" });
  });

  it("a loop the repository does not have is a 404", async () => {
    await expect(page("merge")).rejects.toThrow(/404/);
  });

  it("names the API error when the loops cannot be read", async () => {
    vi.mocked(getRepoLoops).mockResolvedValue({
      status: "error",
      message: "HTTP 502",
    } as never);

    render(await page("triage"));

    expect(
      screen.getByText(/Could not load the repository's loops \(HTTP 502\)/),
    ).toBeTruthy();
  });
});
