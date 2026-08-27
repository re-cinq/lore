import { describe, it, expect } from "vitest";
import {
  capTerminalOutput,
  TERMINAL_OUTPUT_MAX_BYTES,
} from "./terminal-output.js";

describe("capTerminalOutput", () => {
  it("returns an output already under the cap untouched", () => {
    expect(capTerminalOutput("REVIEW_RESULT:APPROVED")).toBe(
      "REVIEW_RESULT:APPROVED",
    );
  });

  it("keeps the last bytes, where the terminal result line lives", () => {
    const verdict = '\n{"type":"result","result":"REVIEW_RESULT:APPROVED"}';

    expect(
      capTerminalOutput("x".repeat(TERMINAL_OUTPUT_MAX_BYTES) + verdict),
    ).toMatch(/REVIEW_RESULT:APPROVED"}$/);
  });

  it("caps at TERMINAL_OUTPUT_MAX_BYTES, counted in bytes not characters", () => {
    const capped = capTerminalOutput("é".repeat(TERMINAL_OUTPUT_MAX_BYTES));

    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(
      TERMINAL_OUTPUT_MAX_BYTES,
    );
  });

  it("cuts on a character boundary — no replacement character at the seam", () => {
    // Three-byte characters are the case that actually breaks: with a two-byte
    // run the cut offset keeps the run's parity and always lands on a boundary,
    // so a naive byte slice would pass. 256 KiB is not a multiple of 3.
    const input = "€".repeat(TERMINAL_OUTPUT_MAX_BYTES);
    const capped = capTerminalOutput(input);

    expect(capped.includes("\uFFFD")).toBe(false);
    expect(input.endsWith(capped)).toBe(true);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(
      TERMINAL_OUTPUT_MAX_BYTES,
    );
  });
});
