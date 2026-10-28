// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const endSession = vi.fn();

vi.mock("@/lib/api/auth", () => ({ endSession }));

const { POST } = await import("./route");

describe("POST /auth/signout", () => {
  it("ends the session at lore-api, drops the cookie and returns to sign in", async () => {
    endSession.mockResolvedValue({ status: "ok", data: { ok: true } });
    const res = await POST(
      new Request("http://pod:3000/auth/signout", {
        method: "POST",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "lore.example",
        },
      }),
    );

    expect({
      ended: endSession.mock.calls.length,
      status: res.status,
      location: res.headers.get("location"),
      cookie: res.headers.get("set-cookie"),
    }).toEqual({
      ended: 1,
      status: 303,
      location: "https://lore.example/auth/signin",
      cookie: expect.stringMatching(
        /^lore_session=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/,
      ),
    });
  });
});
