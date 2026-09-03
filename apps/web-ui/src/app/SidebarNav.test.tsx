// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pathname = vi.fn<() => string>(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

const linkStatus = vi.fn(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus() };
});

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-icon={name} aria-hidden="true" />
  ),
}));

import SidebarNav from "./SidebarNav";

const PRIMARY_LINKS = [
  { href: "/", label: "Repos" },
  { href: "/assembly-runs", label: "Assembly Runs" },
  { href: "/agents", label: "Agents" },
  { href: "/cluster-agents", label: "Clusters" },
  { href: "/search", label: "Search" },
  { href: "/audit", label: "Audit" },
  { href: "/pools", label: "Pools" },
  { href: "/analytics", label: "Analytics" },
  { href: "/spend", label: "Spend" },
  { href: "/gaps", label: "Gaps" },
  { href: "/episodes", label: "Episodes" },
  { href: "/graph", label: "Graph" },
  { href: "/specs", label: "Specs" },
  { href: "/adrs", label: "ADRs" },
];
const SETTINGS = { href: "/settings", label: "Settings" };
const ADD_REPO = { href: "/onboard", label: "+ Add Repo" };
const FOOTER_LINKS = [SETTINGS, ADD_REPO];
const ALL_LINKS = [...PRIMARY_LINKS, ...FOOTER_LINKS];

function linkByLabel(label: string): HTMLAnchorElement {
  return screen.getByRole("link", { name: label }) as HTMLAnchorElement;
}

beforeEach(() => {
  pathname.mockReturnValue("/");
  linkStatus.mockReturnValue({ pending: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SidebarNav rendering", () => {
  it("renders every nav link with its href and label exactly once", () => {
    render(<SidebarNav />);
    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(ALL_LINKS.length);

    for (const { href, label } of ALL_LINKS) {
      const link = linkByLabel(label);

      expect(link).toHaveAttribute("href", href);
    }
  });

  it("renders the primary links inside a single nav element in declared order", () => {
    const { container } = render(<SidebarNav />);
    const nav = container.querySelector("nav");

    expect(nav).not.toBeNull();
    const rendered = Array.from(nav!.querySelectorAll("a")).map(
      (a) => a.textContent,
    );

    expect(rendered).toEqual(PRIMARY_LINKS.map((l) => l.label));
  });

  it("pins the Settings and Add Repo actions outside the scrollable nav", () => {
    const { container } = render(<SidebarNav />);
    const nav = container.querySelector("nav");

    for (const { href, label } of FOOTER_LINKS) {
      const link = linkByLabel(label);

      expect(link).toHaveAttribute("href", href);
      expect(nav!.contains(link)).toBe(false);
    }
  });

  it("applies the distinguishing module classes to the footer links only", () => {
    render(<SidebarNav />);
    expect(linkByLabel("+ Add Repo").className).toContain("addRepo");
    expect(linkByLabel("Settings").className).toContain("footerLink");

    expect(linkByLabel("Repos").className).not.toContain("addRepo");
    expect(linkByLabel("Repos").className).not.toContain("footerLink");
  });
});

describe("SidebarNav active-link highlighting", () => {
  it('marks only the root "Repos" link active on the exact root path "/"', () => {
    pathname.mockReturnValue("/");
    render(<SidebarNav />);

    const repos = linkByLabel("Repos");

    expect(repos.className).toContain("active");
    expect(repos).toHaveAttribute("aria-current", "page");

    for (const { label } of [...PRIMARY_LINKS.slice(1), ...FOOTER_LINKS]) {
      const link = linkByLabel(label);

      expect(link.className).not.toContain("active");
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it('does not light up "Repos" when on a deeper route (root matches exact path only)', () => {
    pathname.mockReturnValue("/analytics");
    render(<SidebarNav />);
    const repos = linkByLabel("Repos");

    expect(repos.className).not.toContain("active");
    expect(repos).not.toHaveAttribute("aria-current");
  });

  it("marks a primary link active on its exact path and nothing else", () => {
    pathname.mockReturnValue("/analytics");
    render(<SidebarNav />);

    const analytics = linkByLabel("Analytics");

    expect(analytics.className).toContain("active");
    expect(analytics).toHaveAttribute("aria-current", "page");

    for (const { label } of ALL_LINKS.filter((l) => l.label !== "Analytics")) {
      const link = linkByLabel(label);

      expect(link.className).not.toContain("active");
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it('marks a primary link active on a sub-route via the "/" boundary (startsWith branch)', () => {
    pathname.mockReturnValue("/audit/entry-123");
    render(<SidebarNav />);

    const audit = linkByLabel("Audit");

    expect(audit.className).toContain("active");
    expect(audit).toHaveAttribute("aria-current", "page");

    expect(linkByLabel("Repos").className).not.toContain("active");
    expect(linkByLabel("Search").className).not.toContain("active");
  });

  it('does not light up a link when the path only shares a string prefix, not a "/" boundary', () => {
    pathname.mockReturnValue("/searching");
    render(<SidebarNav />);
    expect(linkByLabel("Search").className).not.toContain("active");
    expect(linkByLabel("Search")).not.toHaveAttribute("aria-current");
  });

  it("marks the Add Repo link active on the /onboard route", () => {
    pathname.mockReturnValue("/onboard");
    render(<SidebarNav />);

    const addRepo = linkByLabel("+ Add Repo");

    expect(addRepo.className).toContain("active");
    expect(addRepo).toHaveAttribute("aria-current", "page");

    expect(addRepo.className).toContain("addRepo");

    for (const { label } of PRIMARY_LINKS) {
      expect(linkByLabel(label).className).not.toContain("active");
    }
  });

  it("marks the Settings link active on the /settings route", () => {
    pathname.mockReturnValue("/settings");
    render(<SidebarNav />);

    const settings = linkByLabel("Settings");

    expect(settings.className).toContain("active");
    expect(settings).toHaveAttribute("aria-current", "page");

    for (const { label } of PRIMARY_LINKS) {
      expect(linkByLabel(label).className).not.toContain("active");
    }
  });

  it("marks the Add Repo link active on an /onboard sub-route", () => {
    pathname.mockReturnValue("/onboard/step-2");
    render(<SidebarNav />);
    const addRepo = linkByLabel("+ Add Repo");

    expect(addRepo.className).toContain("active");
    expect(addRepo).toHaveAttribute("aria-current", "page");
  });

  it("leaves all links inactive on an unrelated path", () => {
    pathname.mockReturnValue("/totally/unrelated");
    render(<SidebarNav />);

    for (const { label } of ALL_LINKS) {
      const link = linkByLabel(label);

      expect(link.className).not.toContain("active");
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("reflects a changed pathname on re-render (active item follows the route)", () => {
    pathname.mockReturnValue("/graph");
    const { rerender } = render(<SidebarNav />);

    expect(linkByLabel("Graph").className).toContain("active");
    expect(linkByLabel("Audit").className).not.toContain("active");

    pathname.mockReturnValue("/audit");
    rerender(<SidebarNav />);
    expect(linkByLabel("Audit").className).toContain("active");
    expect(linkByLabel("Graph").className).not.toContain("active");
  });
});

describe("SidebarNav pending navigation state", () => {
  it("renders the loading spinner on every link while navigation is in flight", () => {
    pathname.mockReturnValue("/search");
    linkStatus.mockReturnValue({ pending: true });
    const { container } = render(<SidebarNav />);

    expect(screen.getAllByRole("status", { name: "loading" })).toHaveLength(
      ALL_LINKS.length,
    );
    const search = container.querySelector(
      'a[href="/search"]',
    ) as HTMLAnchorElement;

    expect(search.className).toContain("active");
    expect(search).toHaveAttribute("aria-current", "page");
  });

  it("renders no spinner when no navigation is pending", () => {
    linkStatus.mockReturnValue({ pending: false });
    render(<SidebarNav />);
    expect(screen.queryByRole("status", { name: "loading" })).toBeNull();
  });
});

describe("SidebarNav interactions", () => {
  it("keeps every link clickable (href targets stay intact after a click)", () => {
    pathname.mockReturnValue("/");
    render(<SidebarNav />);
    const graph = linkByLabel("Graph");

    fireEvent.click(graph);
    expect(graph).toHaveAttribute("href", "/graph");
  });
});

describe("SidebarNav accordion groups", () => {
  const GROUP_HEADERS = ["Insights"];

  it("renders every labelled group as an expanded collapse header", () => {
    render(<SidebarNav />);

    for (const label of GROUP_HEADERS) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
  });

  it("keeps the label-less top group headerless so Repos is always visible", () => {
    render(<SidebarNav />);
    expect(linkByLabel("Repos")).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "Repos" })).toBeNull();
  });

  it("hides only that group's links when a header is collapsed", () => {
    render(<SidebarNav />);
    const insights = screen.getByRole("button", { name: "Insights" });

    fireEvent.click(insights);

    expect(insights).toHaveAttribute("aria-expanded", "false");

    for (const label of [
      "Analytics",
      "Spend",
      "Gaps",
      "Episodes",
      "Graph",
      "Specs",
      "ADRs",
    ]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    expect(linkByLabel("Repos")).toBeInTheDocument();
    expect(linkByLabel("Search")).toBeInTheDocument();
    expect(linkByLabel("Settings")).toBeInTheDocument();
    expect(linkByLabel("+ Add Repo")).toBeInTheDocument();
  });

  it("restores a group's links when its header is toggled back open", () => {
    render(<SidebarNav />);
    const insights = screen.getByRole("button", { name: "Insights" });

    fireEvent.click(insights);
    expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();

    fireEvent.click(insights);
    expect(insights).toHaveAttribute("aria-expanded", "true");
    expect(linkByLabel("Analytics")).toHaveAttribute("href", "/analytics");
  });
});
