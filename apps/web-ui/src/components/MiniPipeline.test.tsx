// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MiniPipeline from "./MiniPipeline";

describe("MiniPipeline", () => {
  it("links to the live run and titles each dot with its node and state", () => {
    render(
      <MiniPipeline
        runId="dbccc0a0-b910-4e1c-bde8-0f90783d98ce"
        pipeline={[
          { node_id: "dod", state: "success" },
          { node_id: "tdd-round", state: "running" },
          { node_id: "await-ci", state: "lint_failed" },
        ]}
      />,
    );

    const link = screen.getByTestId("mini-pipeline");

    expect({
      href: link.getAttribute("href"),
      dots: Array.from(link.querySelectorAll("span")).map((dot) =>
        dot.getAttribute("title"),
      ),
    }).toEqual({
      href: "/assembly-runs/dbccc0a0-b910-4e1c-bde8-0f90783d98ce",
      dots: ["dod: success", "tdd-round: running", "await-ci: lint_failed"],
    });
  });
});
