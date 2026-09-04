// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { authOptions } from "./auth-options";

type SignIn = NonNullable<typeof authOptions.callbacks>["signIn"];

const signIn = authOptions.callbacks!.signIn! as (
  params: Parameters<NonNullable<SignIn>>[0],
) => Promise<boolean>;

const account = { access_token: "gh-token" } as Parameters<
  NonNullable<SignIn>
>[0]["account"];

const realFetch = global.fetch;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.GITHUB_ALLOWED_ORG;
  vi.restoreAllMocks();
});

describe("authOptions.callbacks.signIn", () => {
  it("allows sign-in when no org restriction is configured", async () => {
    delete process.env.GITHUB_ALLOWED_ORG;
    const result = await signIn({
      account,
      profile: { login: "alice" },
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(true);
  });

  it("denies sign-in when the org membership check request fails", async () => {
    process.env.GITHUB_ALLOWED_ORG = "re-cinq";
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })) as unknown as typeof fetch;

    const result = await signIn({
      account,
      profile: { login: "alice" },
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(false);
  });

  it("allows sign-in when the user is a member of the allowed org", async () => {
    process.env.GITHUB_ALLOWED_ORG = "re-cinq";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ login: "re-cinq" }, { login: "other-org" }],
    })) as unknown as typeof fetch;

    const result = await signIn({
      account,
      profile: { login: "alice" },
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(true);
  });

  it("denies sign-in when the user's orgs do not include the allowed org", async () => {
    process.env.GITHUB_ALLOWED_ORG = "re-cinq";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ login: "other-org" }],
    })) as unknown as typeof fetch;

    const result = await signIn({
      account,
      profile: { login: "alice" },
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(false);
  });

  it("denies sign-in when the org check throws", async () => {
    process.env.GITHUB_ALLOWED_ORG = "re-cinq";
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await signIn({
      account,
      profile: { login: "alice" },
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(false);
  });

  it("labels the user 'unknown' in logs when the profile has no login", async () => {
    process.env.GITHUB_ALLOWED_ORG = "re-cinq";
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ login: "other-org" }],
    })) as unknown as typeof fetch;

    const result = await signIn({
      account,
      profile: {},
    } as unknown as Parameters<NonNullable<SignIn>>[0]);

    expect(result).toBe(false);
  });
});
