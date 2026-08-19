import { describe, expect, it } from "vitest";
import { shouldCaptureBaseline } from "./baseline-capture.js";

describe("shouldCaptureBaseline", () => {
  it("captures when a repo turns dark mode on for the first time", () => {
    expect(shouldCaptureBaseline({}, { enabled: true })).toBe(true);
  });

  it("captures when enabled goes explicitly false to true", () => {
    expect(shouldCaptureBaseline({ enabled: false }, { enabled: true })).toBe(
      true,
    );
  });

  it("does not capture on a write that leaves dark mode already on", () => {
    // A settings edit while enabled would snapshot a window that is already
    // post-enablement, overwriting the real pre-enable baseline with a useless
    // one — the comparison SC1 exists to make.
    expect(shouldCaptureBaseline({ enabled: true }, { enabled: true })).toBe(
      false,
    );
  });

  it("does not capture when dark mode is turned off", () => {
    expect(shouldCaptureBaseline({ enabled: true }, { enabled: false })).toBe(
      false,
    );
  });

  it("does not capture on an unrelated edit while dark mode is off", () => {
    expect(
      shouldCaptureBaseline(
        { enabled: false, review: "bot" },
        { enabled: false, review: "human" },
      ),
    ).toBe(false);
  });
});
