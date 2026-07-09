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

// The grouped primary links plus the trailing "+ Add Repo" entry, in render order.
const PRIMARY_LINKS = [
  { href: "/", label: "Repos" },
  { href: "/assembly-lines", label: "Assembly Lines" },
  { href: "/tasks", label: "Tasks" },
  { href: "/context", label: "Context" },
  { href: "/specs", label: "Specs" },
  { href: "/gaps", label: "Gaps" },
  { href: "/pools", label: "Pools" },
  { href: "/graph", label: "Graph" },
  { href: "/episodes", label: "Episodes" },
  { href: "/analytics", label: "Analytics" },
  { href: "/spend", label: "Spend" },
  { href: "/search", label: "Search" },
  { href: "/audit", label: "Audit" },
  { href: "/agents", label: "Agents" },
  { href: "/settings", label: "Settings" },
];
const ADD_REPO = { href: "/onboard", label: "+ Add Repo" };
const ALL_LINKS = [...PRIMARY_LINKS, ADD_REPO];

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

  it("pins the Add Repo action outside the scrollable nav", () => {
    const { container } = render(<SidebarNav />);
    const nav = container.querySelector("nav");
    const addRepo = linkByLabel("+ Add Repo");
    expect(addRepo).toHaveAttribute("href", "/onboard");
    expect(nav!.contains(addRepo)).toBe(false);
  });

  it("applies the distinguishing module class to the Add Repo link only", () => {
    render(<SidebarNav />);
    const addRepo = linkByLabel("+ Add Repo");
    // The module class SidebarNav passes through to the extra NavLink.
    expect(addRepo.className).toContain("addRepo");

    // A primary link carries no such class.
    expect(linkByLabel("Repos").className).not.toContain("addRepo");
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
    for (const { label } of [...PRIMARY_LINKS.slice(1), ADD_REPO]) {
      const link = linkByLabel(label);
      expect(link.className).not.toContain("active");
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it('does not light up "Repos" when on a deeper route (root matches exact path only)', () => {
    // rootHref branch: href === '/' must match the path exactly, never as a prefix.
    pathname.mockReturnValue("/assembly-lines");
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
    pathname.mockReturnValue("/assembly-lines/abc-123");
    render(<SidebarNav />);

    const pipeline = linkByLabel("Assembly Lines");
    expect(pipeline.className).toContain("active");
    expect(pipeline).toHaveAttribute("aria-current", "page");

    // The sibling whose href is a string-prefix-but-not-path-prefix stays inactive.
    expect(linkByLabel("Repos").className).not.toContain("active");
    expect(linkByLabel("Settings").className).not.toContain("active");
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
  it("highlights every link label as pending while navigation is in flight", () => {
    // useLinkStatus pending=true drives the NavLabel `pending` class on every
    // link SidebarNav composes; the loading animation now lives on-screen
    // (app/loading.tsx), so there is no spinner icon in the nav.
    pathname.mockReturnValue("/search");
    linkStatus.mockReturnValue({ pending: true });
    const { container } = render(<SidebarNav />);

    expect(container.querySelectorAll(".nav-label.pending")).toHaveLength(
      ALL_LINKS.length,
    );
    // With no spinner folding into the accessible name, the label matches cleanly.
    const search = linkByLabel("Search");
    expect(search.className).toContain("active");
    expect(search).toHaveAttribute("aria-current", "page");
  });

  it("applies no pending highlight and renders no spinner when navigation is idle", () => {
    linkStatus.mockReturnValue({ pending: false });
    const { container } = render(<SidebarNav />);
    expect(container.querySelectorAll(".nav-label.pending")).toHaveLength(0);
    expect(screen.queryByRole("status", { name: "loading" })).toBeNull();
  });
});

describe("SidebarNav interactions", () => {
  it("keeps every link clickable (href targets stay intact after a click)", () => {
    pathname.mockReturnValue("/");
    render(<SidebarNav />);
    const pipeline = linkByLabel("Assembly Lines");
    // Clicking does not mutate the rendered anchor target; SidebarNav relies on
    // the router (mocked away) for navigation.
    fireEvent.click(pipeline);
    expect(pipeline).toHaveAttribute("href", "/assembly-lines");
  });
});

describe("SidebarNav accordion groups", () => {
  const GROUP_HEADERS = ["Pipeline", "Knowledge", "Insights", "Config"];

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
    const knowledge = screen.getByRole("button", { name: "Knowledge" });

    fireEvent.click(knowledge);

    expect(knowledge).toHaveAttribute("aria-expanded", "false");
    // Every Knowledge link is gone…
    for (const label of ["Context", "Specs", "Gaps", "Pools", "Graph", "Episodes"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
    // …while a sibling group and the always-on links stay put.
    expect(linkByLabel("Analytics")).toBeInTheDocument();
    expect(linkByLabel("Repos")).toBeInTheDocument();
    expect(linkByLabel("+ Add Repo")).toBeInTheDocument();
  });

  it("restores a group's links when its header is toggled back open", () => {
    render(<SidebarNav />);
    const knowledge = screen.getByRole("button", { name: "Knowledge" });

    fireEvent.click(knowledge);
    expect(screen.queryByRole("link", { name: "Context" })).toBeNull();

    fireEvent.click(knowledge);
    expect(knowledge).toHaveAttribute("aria-expanded", "true");
    expect(linkByLabel("Context")).toHaveAttribute("href", "/context");
  });
});
