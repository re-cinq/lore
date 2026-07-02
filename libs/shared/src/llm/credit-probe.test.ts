import { describe, it, expect, vi } from "vitest";
import { anthropicCreditsExhausted } from "./credit-probe.js";

const resp = (status: number, body = "") =>
  ({ status, text: async () => body }) as Response;

describe("anthropicCreditsExhausted", () => {
  it("returns false without calling the API when ANTHROPIC_API_KEY is unset", async () => {
    const fetchImpl = vi.fn();
    expect(await anthropicCreditsExhausted({}, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns true on a 429 whose body names a billing/credit problem", async () => {
    const fetchImpl = vi.fn(async () => resp(429, "Your credit balance is too low"));
    expect(
      await anthropicCreditsExhausted({ ANTHROPIC_API_KEY: "k" }, fetchImpl as unknown as typeof fetch),
    ).toBe(true);
  });

  it("returns true on a 403 billing error", async () => {
    const fetchImpl = vi.fn(async () => resp(403, "billing issue"));
    expect(
      await anthropicCreditsExhausted({ ANTHROPIC_API_KEY: "k" }, fetchImpl as unknown as typeof fetch),
    ).toBe(true);
  });

  it("returns false on a 429 that is a plain rate-limit (not a credit problem)", async () => {
    const fetchImpl = vi.fn(async () => resp(429, "rate limit exceeded"));
    expect(
      await anthropicCreditsExhausted({ ANTHROPIC_API_KEY: "k" }, fetchImpl as unknown as typeof fetch),
    ).toBe(false);
  });

  it("returns false on a 200 (credits fine)", async () => {
    const fetchImpl = vi.fn(async () => resp(200, "{}"));
    expect(
      await anthropicCreditsExhausted({ ANTHROPIC_API_KEY: "k" }, fetchImpl as unknown as typeof fetch),
    ).toBe(false);
  });

  it("returns false when the request throws (network error — let real calls surface it)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(
      await anthropicCreditsExhausted({ ANTHROPIC_API_KEY: "k" }, fetchImpl as unknown as typeof fetch),
    ).toBe(false);
  });
});
