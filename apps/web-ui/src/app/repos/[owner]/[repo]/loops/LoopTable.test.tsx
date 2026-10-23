// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LoopTable, { ActionsCell, StatusCell, timeAgo } from "./LoopTable";

const now = new Date("2026-08-26T10:00:00Z");

describe("timeAgo", () => {
  it("renders seconds, minutes, hours, and days at the right unit", () => {
    expect(
      [
        "2026-08-26T09:59:30Z",
        "2026-08-26T09:57:00Z",
        "2026-08-26T09:00:00Z",
        "2026-08-24T10:00:00Z",
        null,
      ].map((iso) => timeAgo(iso, now)),
    ).toEqual(["just now", "3 minutes ago", "1 hour ago", "2 days ago", ""]);
  });
});

describe("LoopTable", () => {
  it("heads the columns Status, the subject, Stages and Actions, and badges an unknown state in the danger tone", () => {
    const { getAllByRole, getByTestId } = render(
      <LoopTable
        subject="Pull request"
        emptyText="Nothing."
        rows={[
          <tr key="1">
            <StatusCell state="exploded" since="2026-08-26T09:00:00Z" />
            <td>#7</td>
            <td />
            <ActionsCell
              runId="run-1"
              external={{ href: "https://gh/pr/7", text: "PR" }}
            />
          </tr>,
        ]}
      />,
    );

    expect({
      heads: getAllByRole("columnheader").map((th) => th.textContent),
      tone: getByTestId("row-status").className.includes("tone_danger"),
      time: getByTestId("row-time").getAttribute("title"),
      links: getAllByRole("link").map((a) => a.getAttribute("href")),
    }).toEqual({
      heads: ["Status", "Pull request", "Stages", "Actions"],
      tone: true,
      time: "2026-08-26T09:00:00Z",
      links: ["/assembly-runs/run-1", "https://gh/pr/7"],
    });
  });

  it("says the empty text instead of an empty table", () => {
    const { getByText, queryByRole } = render(
      <LoopTable subject="Ticket" emptyText="No ticket yet." rows={[]} />,
    );

    expect([
      getByText("No ticket yet.").textContent,
      queryByRole("table"),
    ]).toEqual(["No ticket yet.", null]);
  });
});
