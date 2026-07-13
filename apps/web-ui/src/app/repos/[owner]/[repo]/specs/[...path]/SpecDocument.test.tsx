// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SpecDocument from "./SpecDocument";
import { type StatementInfo } from "../SpecDetails";

describe("SpecDocument", () => {
  it("renders two framed section cards for two markdown sections", () => {
    const content = "## Goals\n\nGoal text.\n\n## Flows\n\nFlow text.\n";
    const statements: StatementInfo[] = [];

    const { container } = render(
      <SpecDocument
        repo="re-cinq/lore"
        content={content}
        statements={statements}
      />,
    );

    expect(container.querySelectorAll("[data-doc-section]")).toHaveLength(2);
  });
});
