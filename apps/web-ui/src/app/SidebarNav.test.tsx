// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// usePathname is the only thing driving SidebarNav. A mutable mock fn lets each
// test pick the "current route" and exercise the active/inactive branches that
// SidebarNav threads into every NavLink via isNavActive.
const pathname = vi.fn<() => string>(() => "/");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

// Keep the REAL NavLink + isNavActive so we assert SidebarNav's real output
// (href, active class, aria-current). Only stub Next's useLinkStatus so the
// pending spinner stays deterministic and never depends on Link internals —
// same convention as src/components/NavLink.test.tsx.
const linkStatus = vi.fn(() => ({ pending: false }));

vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();

  return { ...actual, useLinkStatus: () => linkStatus() };
});

// Icon pulls in ThemeProvider context; stub it so the accordion chevron renders
// as an inert, aria-hidden node and never contributes to a control's a11y name.
vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-icon={name} aria-hidden="true" />
  ),
}));

import SidebarNav from "./SidebarNav";

// The nav links rendered inside <nav>, in render order: the headerless top
// cluster (Repos + global views) then the Insights group.
const PRIMARY_LINKS = [
  { href: "/", label: "Repos" },
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
// Pinned outside the scrollable nav.
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

    // A primary link carries no such class.
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

    // Every other link is inactive — including ones whose href is a prefix of "/".
    for (const { label } of [...PRIMARY_LINKS.slice(1), ...FOOTER_LINKS]) {
      const link = linkByLabel(label);

      expect(link.className).not.toContain("active");
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it('does not light up "Repos" when on a deeper route (root matches exact path only)', () => {
    // rootHref branch: href === '/' must match the path exactly, never as a prefix.
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
    // isNavActive non-root branch: pathname.startsWith(`${href}/`).
    pathname.mockReturnValue("/audit/entry-123");
    render(<SidebarNav />);

    const audit = linkByLabel("Audit");

    expect(audit.className).toContain("active");
    expect(audit).toHaveAttribute("aria-current", "page");

    // The root link whose href is a string-prefix-but-not-path-prefix stays inactive.
    expect(linkByLabel("Repos").className).not.toContain("active");
    expect(linkByLabel("Search").className).not.toContain("active");
  });

  it('does not light up a link when the path only shares a string prefix, not a "/" boundary', () => {
    // Guards the `/` boundary: "/searching" must NOT activate "/search".
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

    // The Add Repo link keeps its distinguishing class regardless of active state.
    expect(addRepo.className).toContain("addRepo");

    // No primary link is active on /onboard.
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
    // useLinkStatus pending=true exercises the NavLabel spinner branch SidebarNav
    // composes for every link, and the matching item still highlights.
    pathname.mockReturnValue("/search");
    linkStatus.mockReturnValue({ pending: true });
    const { container } = render(<SidebarNav />);

    // One spinner per rendered link (NavLabelLive reads useLinkStatus each time).
    expect(screen.getAllByRole("status", { name: "loading" })).toHaveLength(
      ALL_LINKS.length,
    );
    // The spinner's aria-label folds into each link's accessible name, so match
    // the active item by href + aria-current rather than by label here.
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

    // Clicking does not mutate the rendered anchor target; SidebarNav relies on
    // the router (mocked away) for navigation.
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

    // Every Insights link is gone…
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
    // …while the always-on top links and footer stay put.
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
