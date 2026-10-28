// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const redeemCode = vi.fn();

vi.mock("@/lib/api/auth", () => ({ redeemCode }));

const { GET } = await import("./route");

const httpsHeaders = {
  "x-forwarded-proto": "https",
  "x-forwarded-host": "lore.example",
};

const callback = (
  query: string,
  headers: Record<string, string> = httpsHeaders,
) => GET(new Request(`http://pod:3000/auth/callback?${query}`, { headers }));

beforeEach(() => {
  vi.clearAllMocks();
  redeemCode.mockResolvedValue({
    status: "ok",
    data: { token: "lore_tok", expires_at: "2026-10-28T18:00:00.000Z" },
  });
});

describe("GET /auth/callback", () => {
  it("keeps the session token in a cookie and sends the person home", async () => {
    const res = await callback("code=abc");

    expect({
      status: res.status,
      location: res.headers.get("location"),
      cookie: res.headers.get("set-cookie"),
    }).toEqual({
      status: 307,
      location: "https://lore.example/",
      cookie:
        "lore_session=lore_tok; Path=/; Expires=Wed, 28 Oct 2026 18:00:00 GMT; Secure; HttpOnly; SameSite=lax",
    });
  });

  it("swaps the code lore-api sent back", async () => {
    await callback("code=abc");

    expect(redeemCode).toHaveBeenCalledWith("abc");
  });

  it("leaves the cookie open to plain http for a local UI", async () => {
    const res = await callback("code=abc", { host: "localhost:3000" });

    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("shows why a person outside the org was turned away", async () => {
    const res = await callback("auth_error=not_in_org");

    expect({
      location: res.headers.get("location"),
      redeemed: redeemCode.mock.calls.length,
    }).toEqual({
      location: "https://lore.example/auth/error?reason=not_in_org",
      redeemed: 0,
    });
  });

  it("tells the person to start again when the code does not redeem", async () => {
    redeemCode.mockResolvedValue({ status: "error", code: 401, message: "no" });
    const res = await callback("code=spent");

    expect({
      location: res.headers.get("location"),
      cookie: res.headers.get("set-cookie"),
    }).toEqual({
      location: "https://lore.example/auth/error?reason=state_expired",
      cookie: null,
    });
  });

  it("answers 400 to a callback with neither a code nor a reason", async () => {
    const res = await callback("");

    expect(res.status).toBe(400);
  });
});
