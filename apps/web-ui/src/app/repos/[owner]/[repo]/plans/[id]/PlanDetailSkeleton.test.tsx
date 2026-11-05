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

function ariaHiddenOf(element: React.ReactElement): string | null {
  return render(element).container.firstElementChild!.getAttribute(
    "aria-hidden",
  );
}

describe("PlanDetailSkeleton", () => {
  it("draws the route skeleton from the header, run and body parts, each hidden from assistive technology", () => {
    const elements = [
      <PlanHeaderSkeleton key="header" />,
      <PlanRunSkeleton key="run" />,
      <PlanBodySkeleton key="body" />,
    ];

    expect({
      route: markupOf(<PlanLoading />),
      hidden: elements.map(ariaHiddenOf),
    }).toEqual({
      route: `<div role="status" aria-label="Loading plan">${elements.map(markupOf).join("")}</div>`,
      hidden: ["true", "true", "true"],
    });
  });
});
