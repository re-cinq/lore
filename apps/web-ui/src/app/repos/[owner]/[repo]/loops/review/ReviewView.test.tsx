// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ReviewRow } from "@/lib/api/code-review";
import ReviewView from "./ReviewView";

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  pr_number: 7,
  pr_url: "https://github.com/acme/widgets/pull/7",
  title: "Fix login",
  draft: false,
  line: "review",
  state: "running",
  run_id: "run-1",
  pipeline: [{ node_id: "review", state: "running" }],
  created_at: "2026-10-23T10:00:00Z",
  ...over,
});

describe("ReviewView", () => {
  it("lists #7 under Current with its review pill, run and PR links, and says the other groups are empty", () => {
    const { getByRole, getAllByRole, getByTestId, getByText } = render(
      <ReviewView
        review={{ current: [row({})], open_pulls: [], recent: [] }}
      />,
    );

    expect({
      headings: ["Current", "Open pull requests", "Recently reviewed"].map(
        (name) => getByRole("heading", { name }).textContent,
      ),
      title: getByText("#7 Fix login").getAttribute("href"),
      pill: getByText("review").textContent,
      status: getByTestId("row-status").textContent,
      stages: getByTestId("mini-pipeline").getAttribute("href"),
      actions: getAllByRole("link", { name: /Run|PR/ }).map((a) =>
        a.getAttribute("href"),
      ),
      empty: [
        getByText("No other pull request is open."),
        getByText("Nothing reviewed yet."),
      ].length,
    }).toEqual({
      headings: ["Current", "Open pull requests", "Recently reviewed"],
      title: "https://github.com/acme/widgets/pull/7",
      pill: "review",
      status: "running",
      stages: "/assembly-runs/run-1",
      actions: [
        "/assembly-runs/run-1",
        "https://github.com/acme/widgets/pull/7",
      ],
      empty: 2,
    });
  });

  it("shows an unreviewed open pull request with no pill, no stages and only its PR link", () => {
    const { getByTestId, getAllByRole, queryByTestId } = render(
      <ReviewView
        review={{
          current: [],
          open_pulls: [
            row({
              line: null,
              state: "unreviewed",
              run_id: null,
              pipeline: null,
              created_at: null,
            }),
          ],
          recent: [],
        }}
      />,
    );

    expect({
      status: getByTestId("row-status").textContent,
      stages: queryByTestId("mini-pipeline"),
      actions: getAllByRole("link", { name: /Run|PR/ }).map(
        (a) => a.textContent,
      ),
    }).toEqual({ status: "unreviewed", stages: null, actions: ["PR"] });
  });
});
