// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/components/Icon", () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import UserMenu, { initials } from "./UserMenu";

afterEach(() => {
  cleanup();
});

const person = (name: string, image: string | null = null) => ({
  name,
  image,
});

describe("UserMenu unauthenticated", () => {
  it("shows only the deployed build when no one is signed in", () => {
    render(<UserMenu version="2f64c1a" user={null} />);
    expect(screen.getByText("lore-ui 2f64c1a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("UserMenu deployed build", () => {
  it("shows the build SHA beside the signed-in name", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada Lovelace")} />);
    expect(screen.getByText("lore-ui 2f64c1a")).toHaveAttribute(
      "title",
      "Deployed build (git SHA)",
    );
  });
});

describe("UserMenu display name", () => {
  it("shows the person's name", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada Lovelace")} />);
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});

describe("UserMenu avatar branch", () => {
  it("renders the avatar img with src and alt when image is present", () => {
    render(
      <UserMenu
        version="2f64c1a"
        user={person("Ada", "https://cdn.example.com/ada.png")}
      />,
    );
    const avatar = screen.getByAltText("avatar") as HTMLImageElement;

    expect(avatar.tagName.toLowerCase()).toBe("img");
    expect(avatar).toHaveAttribute("src", "https://cdn.example.com/ada.png");
  });

  it("draws the initials in place of a missing picture", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada Lovelace")} />);
    expect(screen.queryByAltText("avatar")).toBeNull();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("renders no avatar img when image is an empty string", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada", "")} />);
    expect(screen.queryByAltText("avatar")).toBeNull();
  });
});

describe("UserMenu sign out", () => {
  it("renders an icon Sign out button titled for the pointer", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada")} />);

    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute(
      "title",
      "Sign out",
    );
  });

  it("posts the sign out form to /auth/signout", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada")} />);

    expect(
      screen.getByRole("button", { name: "Sign out" }).closest("form"),
    ).toHaveAttribute("action", "/auth/signout");
  });
});

describe("UserMenu settings link", () => {
  it("renders no settings link (settings lives in the sidebar nav now)", () => {
    render(<UserMenu version="2f64c1a" user={person("Ada")} />);
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
