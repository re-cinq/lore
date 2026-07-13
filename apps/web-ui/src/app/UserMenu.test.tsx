// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// next-auth's useSession is the only data source: drive it through a mutable
// fn so each test picks the session shape (null / no-user / image / name /
// email-fallback) without re-mocking the module. signOut is a spy we assert on.
type MockUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};
type MockSession = { user?: MockUser } | null;

let session: MockSession = null;
const signOutSpy = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session }),
  signOut: (...args: unknown[]) => signOutSpy(...args),
}));

import UserMenu from "./UserMenu";

beforeEach(() => {
  session = null;
  signOutSpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UserMenu unauthenticated guard", () => {
  it("renders nothing when session is null", () => {
    session = null;
    const { container } = render(<UserMenu />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when session has no user", () => {
    session = {};
    const { container } = render(<UserMenu />);

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when session.user is null", () => {
    session = { user: null as unknown as MockUser };
    const { container } = render(<UserMenu />);

    expect(container.firstChild).toBeNull();
  });

  it("renders no Sign out button when unauthenticated", () => {
    session = null;
    render(<UserMenu />);
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("UserMenu authenticated display name", () => {
  it("shows the user name when name is present", () => {
    session = { user: { name: "Ada Lovelace", email: "ada@example.com" } };
    render(<UserMenu />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).toBeNull();
  });

  it("falls back to the email when name is missing", () => {
    session = { user: { email: "grace@example.com" } };
    render(<UserMenu />);
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  it("falls back to the email when name is an empty string", () => {
    session = { user: { name: "", email: "fallback@example.com" } };
    render(<UserMenu />);
    expect(screen.getByText("fallback@example.com")).toBeInTheDocument();
  });

  it("falls back to the email when name is null", () => {
    session = { user: { name: null, email: "null-name@example.com" } };
    render(<UserMenu />);
    expect(screen.getByText("null-name@example.com")).toBeInTheDocument();
  });
});

describe("UserMenu avatar branch", () => {
  it("renders the avatar img with src and alt when image is present", () => {
    session = {
      user: { name: "Ada", image: "https://cdn.example.com/ada.png" },
    };
    render(<UserMenu />);
    const avatar = screen.getByAltText("avatar") as HTMLImageElement;

    expect(avatar.tagName.toLowerCase()).toBe("img");
    expect(avatar).toHaveAttribute("src", "https://cdn.example.com/ada.png");
  });

  it("renders no avatar img when image is absent", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu />);
    expect(screen.queryByAltText("avatar")).toBeNull();
  });

  it("renders no avatar img when image is an empty string", () => {
    session = { user: { name: "Ada", image: "" } };
    render(<UserMenu />);
    expect(screen.queryByAltText("avatar")).toBeNull();
  });

  it("renders the name alongside the avatar when both are present", () => {
    session = {
      user: { name: "Ada", image: "https://cdn.example.com/ada.png" },
    };
    render(<UserMenu />);
    expect(screen.getByAltText("avatar")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});

describe("UserMenu sign out interaction", () => {
  it("renders an enabled Sign out button when authenticated", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu />);
    const button = screen.getByRole("button", { name: "Sign out" });

    expect(button).toHaveClass("btn-secondary");
  });

  it("calls signOut when the Sign out button is clicked", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call signOut before the button is clicked", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu />);
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});
