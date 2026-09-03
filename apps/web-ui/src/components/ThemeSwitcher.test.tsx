// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ColorSchemePref, ThemeFamily } from "@/lib/theme/types";

vi.mock("./Icon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`icon-${name}`} />
  ),
}));

const setFamily = vi.fn();
const setScheme = vi.fn();
let family: ThemeFamily = "elegant";
let scheme: ColorSchemePref = "auto";

vi.mock("@/lib/theme/ThemeProvider", () => ({
  useTheme: () => ({ family, scheme, setFamily, setScheme }),
}));

import ThemeSwitcher from "./ThemeSwitcher";

beforeEach(() => {
  setFamily.mockReset();
  setScheme.mockReset();
  family = "elegant";
  scheme = "auto";
});

describe("ThemeSwitcher", () => {
  it("renders all three family options and all three appearance options", () => {
    render(<ThemeSwitcher />);

    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Elegant" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Retro" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Classic" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Auto" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
  });

  it("maps each appearance option to its icon (sun / monitor / moon)", () => {
    render(<ThemeSwitcher />);

    expect(screen.getByTestId("icon-sun")).toBeInTheDocument();
    expect(screen.getByTestId("icon-monitor")).toBeInTheDocument();
    expect(screen.getByTestId("icon-moon")).toBeInTheDocument();
  });

  it("checks only the active family radio and titles each appearance option", () => {
    family = "retro";
    render(<ThemeSwitcher />);

    expect(screen.getByRole("radio", { name: "Retro" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Elegant" })).not.toBeChecked();

    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-label",
      "Light",
    );
    expect(screen.getByTitle("Dark")).toBeInTheDocument();
  });

  it("marks the elegant family label selected and the retro label not, when family is elegant", () => {
    family = "elegant";
    render(<ThemeSwitcher />);

    const elegant = screen.getByRole("radio", { name: "Elegant" });
    const retro = screen.getByRole("radio", { name: "Retro" });

    expect(elegant).toBeChecked();
    expect(retro).not.toBeChecked();
    expect(elegant.closest("label")?.className).toMatch(/selected/);
    expect(retro.closest("label")?.className).not.toMatch(/selected/);
  });

  it("marks only the active appearance label selected, when scheme is dark", () => {
    scheme = "dark";
    render(<ThemeSwitcher />);

    const dark = screen.getByRole("radio", { name: "Dark" });
    const light = screen.getByRole("radio", { name: "Light" });
    const auto = screen.getByRole("radio", { name: "Auto" });

    expect(dark).toBeChecked();
    expect(light).not.toBeChecked();
    expect(auto).not.toBeChecked();
    expect(dark.closest("label")?.className).toMatch(/selected/);
    expect(light.closest("label")?.className).not.toMatch(/selected/);
  });

  it("calls setFamily with retro when the inactive retro radio is selected", () => {
    family = "elegant";
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole("radio", { name: "Retro" }));

    expect(setFamily).toHaveBeenCalledTimes(1);
    expect(setFamily).toHaveBeenCalledWith("retro");
    expect(setScheme).not.toHaveBeenCalled();
  });

  it("calls setFamily with elegant when the inactive elegant radio is selected", () => {
    family = "retro";
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole("radio", { name: "Elegant" }));

    expect(setFamily).toHaveBeenCalledWith("elegant");
  });

  it("calls setScheme with light and dark when those inactive radios are selected", () => {
    scheme = "auto";
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(setScheme.mock.calls.map((c) => c[0])).toEqual(["light", "dark"]);
    expect(setFamily).not.toHaveBeenCalled();
  });

  it("calls setScheme with auto when the inactive auto radio is selected", () => {
    scheme = "dark";
    render(<ThemeSwitcher />);

    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));

    expect(setScheme).toHaveBeenCalledWith("auto");
  });
});
