// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

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

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import UserMenu, { initials } from "./UserMenu";

beforeEach(() => {
  session = null;
  signOutSpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("UserMenu unauthenticated", () => {
  it("shows only the deployed build when no one is signed in", () => {
    session = null;
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("lore-ui 2f64c1a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("shows only the deployed build when the session has no user", () => {
    session = {};
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("lore-ui 2f64c1a")).toBeInTheDocument();
    expect(screen.queryByAltText("avatar")).toBeNull();
  });
});

describe("UserMenu deployed build", () => {
  it("shows the build SHA beside the signed-in name", () => {
    session = { user: { name: "Ada Lovelace" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("lore-ui 2f64c1a")).toHaveAttribute(
      "title",
      "Deployed build (git SHA)",
    );
  });
});

describe("UserMenu authenticated display name", () => {
  it("shows the user name when name is present", () => {
    session = { user: { name: "Ada Lovelace", email: "ada@example.com" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("ada@example.com")).toBeNull();
  });

  it("falls back to the email when name is missing", () => {
    session = { user: { email: "grace@example.com" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  it("falls back to the email when name is an empty string", () => {
    session = { user: { name: "", email: "fallback@example.com" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("fallback@example.com")).toBeInTheDocument();
  });

  it("falls back to the email when name is null", () => {
    session = { user: { name: null, email: "null-name@example.com" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByText("null-name@example.com")).toBeInTheDocument();
  });
});

describe("UserMenu avatar branch", () => {
  it("renders the avatar img with src and alt when image is present", () => {
    session = {
      user: { name: "Ada", image: "https://cdn.example.com/ada.png" },
    };
    render(<UserMenu version="2f64c1a" />);
    const avatar = screen.getByAltText("avatar") as HTMLImageElement;

    expect(avatar.tagName.toLowerCase()).toBe("img");
    expect(avatar).toHaveAttribute("src", "https://cdn.example.com/ada.png");
  });

  it("draws the initials in place of a missing picture", () => {
    session = { user: { name: "Ada Lovelace" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.queryByAltText("avatar")).toBeNull();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("renders no avatar img when image is an empty string", () => {
    session = { user: { name: "Ada", image: "" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.queryByAltText("avatar")).toBeNull();
  });

  it("renders the name alongside the avatar when both are present", () => {
    session = {
      user: { name: "Ada", image: "https://cdn.example.com/ada.png" },
    };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.getByAltText("avatar")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});

describe("UserMenu sign out interaction", () => {
  it("renders an icon Sign out button titled for the pointer", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu version="2f64c1a" />);
    const button = screen.getByRole("button", { name: "Sign out" });

    expect(button).toHaveAttribute("title", "Sign out");
  });

  it("calls signOut when the Sign out button is clicked", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu version="2f64c1a" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call signOut before the button is clicked", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu version="2f64c1a" />);
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});

describe("UserMenu settings link", () => {
  it("renders no settings link (settings lives in the sidebar nav now)", () => {
    session = { user: { name: "Ada" } };
    render(<UserMenu version="2f64c1a" />);
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});

describe("initials", () => {
  it("takes the first and last word of a name", () => {
    expect(initials("Ada Grace Lovelace")).toBe("AL");
  });

  it("takes an email's local part, split on dots", () => {
    expect(initials("grace.hopper@example.com")).toBe("GH");
  });

  it("falls back to a question mark when there is no name", () => {
    expect(initials(null)).toBe("?");
  });
});
