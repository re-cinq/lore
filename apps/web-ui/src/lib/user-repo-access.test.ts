import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const repoAccess = vi.fn();

vi.mock("@/lib/api/auth", () => ({ repoAccess }));

const { userCanAccessRepo } = await import("./user-repo-access");

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("userCanAccessRepo", () => {
  it("returns true when lore-api says the repo is in the person's list", async () => {
    repoAccess.mockResolvedValue({ status: "ok", data: { allowed: true } });

    expect(await userCanAccessRepo("re-cinq/lore")).toBe(true);
  });

  it("logs nothing when the repo is in the person's list", async () => {
    repoAccess.mockResolvedValue({ status: "ok", data: { allowed: true } });
    await userCanAccessRepo("re-cinq/lore");

    expect(warn).not.toHaveBeenCalled();
  });

  it("asks lore-api about the repo that was named", async () => {
    repoAccess.mockResolvedValue({ status: "ok", data: { allowed: true } });
    await userCanAccessRepo("re-cinq/lore");

    expect(repoAccess).toHaveBeenCalledWith("re-cinq/lore");
  });

  it("returns false and logs why when the repo is not in the person's list", async () => {
    repoAccess.mockResolvedValue({ status: "ok", data: { allowed: false } });

    expect(await userCanAccessRepo("re-cinq/secret")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[repo-access] denied re-cinq/secret: the repo is not in the person's list from sign-in",
    );
  });

  it("returns false and logs the status when lore-api refuses the token", async () => {
    repoAccess.mockResolvedValue({
      status: "error",
      code: 403,
      message: "insufficient scope",
    });

    expect(await userCanAccessRepo("re-cinq/lore")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[repo-access] denied re-cinq/lore: lore-api answered 403: insufficient scope",
    );
  });

  it("returns false and says so when lore-api is not configured", async () => {
    repoAccess.mockResolvedValue({ status: "unconfigured" });

    expect(await userCanAccessRepo("re-cinq/lore")).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[repo-access] denied re-cinq/lore: lore-api is not configured",
    );
  });
});
