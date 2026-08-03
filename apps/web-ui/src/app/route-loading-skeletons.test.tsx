// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HomeLoading from "./loading";
import RepoOverviewLoading from "./repos/[owner]/[repo]/loading";
import SearchLoading from "./search/loading";
import ContextLoading from "./context/loading";

const routes: Array<[string, React.ComponentType, string]> = [
  ["home", HomeLoading, "Loading repositories"],
  ["repo overview", RepoOverviewLoading, "Loading repository overview"],
  ["search", SearchLoading, "Loading search"],
  ["context", ContextLoading, "Loading context"],
];

describe("route loading skeletons", () => {
  it.each(routes)(
    "renders a labeled status region of skeleton blocks for the %s route",
    (_name, Loading, label) => {
      const { container } = render(<Loading />);

      expect(screen.getByRole("status")).toHaveAccessibleName(label);
      expect(
        container.querySelectorAll(".skeleton").length,
      ).toBeGreaterThanOrEqual(3);
    },
  );
});
