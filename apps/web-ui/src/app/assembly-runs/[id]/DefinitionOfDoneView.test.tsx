// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DefinitionOfDoneView from "./DefinitionOfDoneView";
import type { DodProgress } from "@/lib/dod-progress-view";

const progress: DodProgress = {
  present: true,
  ticketClaim: "Readers see CI progress on the run page.",
  strategy: "direct",
  why: "one card, no new state",
  acceptanceTests: [
    {
      path: "src/lib/dod-progress-view.test.ts",
      name: "counts passes against the total",
      behaviour: "the header reads N of M",
      status: "pass",
      matchedId:
        "src/lib/dod-progress-view.test.ts::counts passes against the total",
    },
    {
      path: "src/app/DefinitionOfDoneView.test.tsx",
      name: "renders each acceptance test",
      behaviour: "one row per test",
      status: "unknown",
      matchedId: null,
    },
  ],
  facets: [
    { text: "header count", done: true },
    { text: "per-test rows", done: false },
  ],
  outOfScope: ["per-it fidelity"],
  passed: 1,
  total: 2,
  report: {
    commit: "abcdef0123456789",
    branch: "feat/x",
    receivedAt: "2026-09-09T10:00:00.000Z",
  },
};

describe("DefinitionOfDoneView", () => {
  it("heads the card with the pass count and the CI commit it came from", () => {
    render(<DefinitionOfDoneView progress={progress} />);

    expect(
      screen.getByText("1 of 2 acceptance tests pass"),
    ).toBeInTheDocument();
    expect(screen.getByText("as reported by CI @ abcdef0")).toBeInTheDocument();
  });

  it("lists each acceptance test with its verdict, explaining one the report did not carry", () => {
    const { container } = render(<DefinitionOfDoneView progress={progress} />);
    const rows = container.querySelectorAll("[data-acceptance]");

    expect(rows[0].getAttribute("data-acceptance")).toBe("pass");
    expect(rows[1]).toHaveTextContent("not in the latest CI report");
    expect(rows[0]).toHaveTextContent("counts passes against the total");
  });

  it("shows the claim, the strategy with its why, the facets' checkboxes and what is out of scope", () => {
    const { container } = render(<DefinitionOfDoneView progress={progress} />);

    expect(
      screen.getByText("Readers see CI progress on the run page."),
    ).toBeInTheDocument();
    expect(screen.getByText("direct")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-facet="done"]')).toHaveLength(1);
    expect(screen.getByText("per-it fidelity")).toBeInTheDocument();
  });

  it("renders the markdown the dod carries as elements, not as literal backticks and asterisks", () => {
    const { container } = render(
      <DefinitionOfDoneView
        progress={{
          ...progress,
          ticketClaim: "Readers see `dod.md` **rendered**.",
          why: "one `card`",
          acceptanceTests: [
            {
              ...progress.acceptanceTests![0],
              behaviour: "the `N of M` header",
            },
          ],
          facets: [{ text: "`header` count", done: true }],
          outOfScope: ["per-`it` fidelity"],
        }}
      />,
    );

    expect({
      codes: container.querySelectorAll("code").length,
      bold: container.querySelector("dd strong")?.textContent,
      literals: /[`*]/.test(container.textContent ?? ""),
    }).toEqual({ codes: 5, bold: "rendered", literals: false });
  });

  it("renders the empty state for a run whose branch carries no definition of done", () => {
    render(<DefinitionOfDoneView progress={{ present: false }} />);

    expect(
      screen.getByText(/No definition of done on this run's branch/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/acceptance tests pass/)).not.toBeInTheDocument();
  });
});
