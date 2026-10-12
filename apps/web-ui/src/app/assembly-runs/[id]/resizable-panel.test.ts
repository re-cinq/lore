import { describe, it, expect } from "vitest";
import {
  PANEL_WIDTH,
  clampPanelWidth,
  readStoredWidth,
  widthFromDrag,
} from "./resizable-panel";

const bounds = { min: 280, max: 720, default: 380 };

describe("clampPanelWidth", () => {
  it("raises 100 to the 280 minimum", () => {
    expect(clampPanelWidth(100, bounds)).toBe(280);
  });

  it("lowers 900 to the 720 maximum", () => {
    expect(clampPanelWidth(900, bounds)).toBe(720);
  });

  it("keeps 400 inside the bounds", () => {
    expect(clampPanelWidth(400, bounds)).toBe(400);
  });
});

describe("widthFromDrag", () => {
  it("widens a 380 panel to 430 when the handle moves 50px left", () => {
    expect(widthFromDrag({ startX: 800, startWidth: 380 }, 750, bounds)).toBe(
      430,
    );
  });

  it("narrows a 380 panel to 330 when the handle moves 50px right", () => {
    expect(widthFromDrag({ startX: 800, startWidth: 380 }, 850, bounds)).toBe(
      330,
    );
  });

  it("stops at the 280 minimum on a long drag right", () => {
    expect(widthFromDrag({ startX: 800, startWidth: 380 }, 1400, bounds)).toBe(
      280,
    );
  });
});

describe("readStoredWidth", () => {
  const storageWith = (value: string | null) => ({ getItem: () => value });

  it("reads a stored 500", () => {
    expect(readStoredWidth(storageWith("500"), "key", bounds)).toBe(500);
  });

  it("returns the 380 default for nothing stored", () => {
    expect(readStoredWidth(storageWith(null), "key", bounds)).toBe(380);
  });

  it("returns the 380 default for a stored word", () => {
    expect(readStoredWidth(storageWith("wide"), "key", bounds)).toBe(380);
  });

  it("clamps a stored 2000 to the 720 maximum", () => {
    expect(readStoredWidth(storageWith("2000"), "key", bounds)).toBe(720);
  });
});

describe("PANEL_WIDTH", () => {
  it("defaults the inspector to 380px between 280 and 720", () => {
    expect(PANEL_WIDTH).toEqual({ min: 280, max: 720, default: 380 });
  });
});
