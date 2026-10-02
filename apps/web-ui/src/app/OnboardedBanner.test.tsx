// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HomeView from "./HomeView";
import OnboardedBanner from "./OnboardedBanner";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

const action = vi.fn();

function renderHome(onboarded?: string | null) {
  return render(
    <HomeView
      repos={[]}
      onboarded={onboarded}
      ingestStatus={new Map()}
      misaligned={[]}
      fixIngestWorkflows={action}
      impactMisaligned={[]}
      fixTraceImpactWorkflows={action}
    />,
  );
}

describe("OnboardedBanner", () => {
  it("confirms the onboarding and links to the repo page", () => {
    render(<OnboardedBanner fullName="re-cinq/lore" />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Onboarding started for re-cinq/lore",
    );
    expect(screen.getByRole("link", { name: "re-cinq/lore" })).toHaveAttribute(
      "href",
      "/repos/re-cinq/lore",
    );
  });

  it("goes away when dismissed", () => {
    render(<OnboardedBanner fullName="re-cinq/lore" />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("HomeView onboarded banner", () => {
  it("shows the banner when a repo was just onboarded", () => {
    renderHome("re-cinq/lore");

    expect(screen.getByRole("status")).toHaveTextContent("re-cinq/lore");
  });

  it("shows no banner when no repo was just onboarded", () => {
    for (const value of [undefined, null]) {
      const { unmount } = renderHome(value);

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      unmount();
    }
  });
});
