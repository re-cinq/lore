import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  privilegedRequestBody,
  isEmptyPatch,
  putPrivilegedSettings,
} from "./mcp-settings";

describe("privilegedRequestBody", () => {
  it("flattens dark_factory fields to the top level with task_overrides as a sibling", () => {
    expect(
      privilegedRequestBody({
        dark_factory: { enabled: true, execution: { image: "golang:1.23" } },
        task_overrides: { review: { model: "claude-opus-4-8" } },
      }),
    ).toEqual({
      enabled: true,
      execution: { image: "golang:1.23" },
      task_overrides: { review: { model: "claude-opus-4-8" } },
    });
  });

  it("omits task_overrides when absent", () => {
    expect(privilegedRequestBody({ dark_factory: { enabled: false } })).toEqual(
      { enabled: false },
    );
  });
});

describe("isEmptyPatch", () => {
  it("true when neither subtree is present", () => {
    expect(isEmptyPatch({})).toBe(true);
  });
  it("false when a subtree is present", () => {
    expect(isEmptyPatch({ dark_factory: { enabled: true } })).toBe(false);
    expect(isEmptyPatch({ task_overrides: { review: {} } })).toBe(false);
  });
});

describe("putPrivilegedSettings", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.LORE_API_URL = "https://lore-api.test";
    process.env.LORE_ADMIN_TOKEN = "admin-tok";
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.LORE_API_URL;
    delete process.env.LORE_ADMIN_TOKEN;
    vi.restoreAllMocks();
  });

  const mockFetch = (status: number, body: unknown) => {
    global.fetch = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
  };

  it("returns unconfigured when env is missing", async () => {
    delete process.env.LORE_API_URL;
    expect(
      await putPrivilegedSettings("o/r", { dark_factory: { enabled: true } }),
    ).toEqual({ status: "unconfigured" });
  });

  it("returns ok with applied + ceremony on 200", async () => {
    mockFetch(200, {
      ok: true,
      applied: { enabled: true },
      ceremony: { tier: "admin" },
    });
    expect(
      await putPrivilegedSettings("o/r", {
        dark_factory: { create_issue: "never" },
      }),
    ).toEqual({
      status: "ok",
      applied: { enabled: true },
      ceremony: { tier: "admin" },
    });
  });

  it("sends the approval-PR header when provided", async () => {
    const spy = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({}) }),
    );
    global.fetch = spy as unknown as typeof fetch;
    await putPrivilegedSettings(
      "o/r",
      { dark_factory: { enabled: true } },
      "o/r#5",
    );
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-lore-approval-pr"]).toBe("o/r#5");
    expect(headers.authorization).toBe("Bearer admin-tok");
  });

  it("maps 403 two_key_required to a two_key_required result", async () => {
    mockFetch(403, {
      error: "two_key_required",
      field_paths: ["execution.image"],
      detail: "need PR",
    });
    expect(
      await putPrivilegedSettings("o/r", {
        dark_factory: { execution: { image: "x" } },
      }),
    ).toEqual({
      status: "two_key_required",
      fieldPaths: ["execution.image"],
      detail: "need PR",
    });
  });

  it("maps 403 codeowners_check_failed to a codeowners_failed result", async () => {
    mockFetch(403, {
      error: "codeowners_check_failed",
      code: "approver_not_codeowner",
      detail: "nope",
    });
    expect(
      await putPrivilegedSettings(
        "o/r",
        { dark_factory: { enabled: true } },
        "o/r#5",
      ),
    ).toEqual({
      status: "codeowners_failed",
      code: "approver_not_codeowner",
      detail: "nope",
    });
  });

  it("maps other non-ok responses to an error result", async () => {
    mockFetch(500, { error: "internal" });
    expect(
      await putPrivilegedSettings("o/r", { dark_factory: { enabled: true } }),
    ).toEqual({ status: "error", message: "internal" });
  });

  it("returns an error result when fetch throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(
      await putPrivilegedSettings("o/r", { dark_factory: { enabled: true } }),
    ).toEqual({ status: "error", message: "network down" });
  });
});
