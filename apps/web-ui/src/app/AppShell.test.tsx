// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pathname = vi.fn(() => "/some/path");

vi.mock("next/navigation", () => ({
  usePathname: () => pathname(),
}));

vi.mock("@/components/Icon", () => ({
  default: ({ name, size }: { name: string; size?: number }) => (
    <span data-testid="icon" data-name={name} data-size={size} />
  ),
}));

import AppShell from "./AppShell";

const layout = () => document.querySelector(".app-layout") as HTMLElement;
const overlay = () => document.querySelector(".sidebar-overlay");
const hamburger = () => screen.getByLabelText("Open menu");
const closeBtn = () => screen.getByLabelText("Close menu");

const renderShell = () =>
  render(
    <AppShell sidebar={<nav data-testid="sidebar-nav">SIDEBAR</nav>}>
      <p data-testid="page-body">PAGE</p>
    </AppShell>,
  );

beforeEach(() => {
  pathname.mockReturnValue("/some/path");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppShell static structure", () => {
  it("renders the sidebar prop, children, and the close-icon marker", () => {
    renderShell();
    expect(screen.getByTestId("sidebar-nav")).toHaveTextContent("SIDEBAR");
    expect(screen.getByTestId("page-body")).toHaveTextContent("PAGE");
    expect(screen.getByText("LORE")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toHaveAttribute("data-name", "close");
    expect(screen.getByTestId("icon")).toHaveAttribute("data-size", "16");
  });

  it("renders the three hamburger bars inside the open-menu button", () => {
    renderShell();
    expect(hamburger().querySelectorAll("span")).toHaveLength(3);
  });
});

describe("AppShell closed state (initial)", () => {
  it("omits the sidebar-open class and renders no overlay", () => {
    renderShell();
    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
  });

  it("marks the hamburger aria-expanded=false while closed", () => {
    renderShell();
    expect(hamburger()).toHaveAttribute("aria-expanded", "false");
  });

  it("focuses the hamburger on mount (closed-branch of the focus effect)", () => {
    renderShell();
    expect(document.activeElement).toBe(hamburger());
  });

  it("ignores an Escape keypress while closed (no listener attached)", () => {
    renderShell();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
  });
});

describe("AppShell opening", () => {
  it("adds the sidebar-open class, renders the overlay, and sets aria-expanded=true on hamburger click", () => {
    renderShell();
    fireEvent.click(hamburger());
    expect(layout().className).toBe("app-layout sidebar-open");
    expect(overlay()).not.toBeNull();
    expect(hamburger()).toHaveAttribute("aria-expanded", "true");
  });

  it("moves focus to the close button when the sidebar opens (open-branch of the focus effect)", () => {
    renderShell();
    fireEvent.click(hamburger());
    expect(document.activeElement).toBe(closeBtn());
  });
});

describe("AppShell closing paths", () => {
  it("closes via the close button and returns focus to the hamburger", () => {
    renderShell();
    fireEvent.click(hamburger());
    fireEvent.click(closeBtn());
    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(hamburger());
  });

  it("closes when the overlay is clicked", () => {
    renderShell();
    fireEvent.click(hamburger());
    fireEvent.click(overlay()!);
    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
  });

  it("closes on the Escape key while open", () => {
    renderShell();
    fireEvent.click(hamburger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
  });

  it("stays open for a non-Escape key while open (false branch of the key check)", () => {
    renderShell();
    fireEvent.click(hamburger());
    fireEvent.keyDown(document, { key: "Enter" });
    expect(layout().className).toBe("app-layout sidebar-open");
    expect(overlay()).not.toBeNull();
  });

  it("detaches the keydown listener after closing so a later Escape is a no-op", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");

    renderShell();
    fireEvent.click(hamburger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });
});

describe("AppShell close-on-navigation effect", () => {
  it("closes the sidebar when the pathname changes", () => {
    const { rerender } = renderShell();

    fireEvent.click(hamburger());
    expect(layout().className).toBe("app-layout sidebar-open");

    pathname.mockReturnValue("/different/path");
    rerender(
      <AppShell sidebar={<nav data-testid="sidebar-nav">SIDEBAR</nav>}>
        <p data-testid="page-body">PAGE</p>
      </AppShell>,
    );

    expect(layout().className).toBe("app-layout");
    expect(overlay()).toBeNull();
  });

  it("leaves a closed sidebar closed when the pathname changes", () => {
    const { rerender } = renderShell();

    pathname.mockReturnValue("/another/path");
    rerender(
      <AppShell sidebar={<nav data-testid="sidebar-nav">SIDEBAR</nav>}>
        <p data-testid="page-body">PAGE</p>
      </AppShell>,
    );
    expect(layout().className).toBe("app-layout");
  });
});

describe("AppShell unmount cleanup", () => {
  it("removes the keydown listener on unmount while open", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderShell();

    fireEvent.click(hamburger());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });
});
