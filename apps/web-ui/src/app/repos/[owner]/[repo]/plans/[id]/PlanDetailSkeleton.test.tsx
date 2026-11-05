// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  PlanBodySkeleton,
  PlanHeaderSkeleton,
  PlanRunSkeleton,
} from "./PlanDetailSkeleton";
import PlanLoading from "./loading";

function markupOf(element: React.ReactElement): string {
  return render(element).container.innerHTML;
}

describe("PlanDetailSkeleton", () => {
  it("draws the route skeleton from the header, run and body parts, each hidden from assistive technology", () => {
    const parts = [
      <PlanHeaderSkeleton key="header" />,
      <PlanRunSkeleton key="run" />,
      <PlanBodySkeleton key="body" />,
    ].map(markupOf);

    expect({
      route: markupOf(<PlanLoading />),
      hidden: parts.map((html) => html.includes('aria-hidden="true"')),
    }).toEqual({
      route: `<div role="status" aria-label="Loading plan">${parts.join("")}</div>`,
      hidden: [true, true, true],
    });
  });
});
