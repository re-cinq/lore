import { describe, it, expect, vi } from "vitest";
import {
  createRepoAccess,
  SIGN_IN_LIST_ONLY,
  type Asker,
} from "./repo-access.js";
import type { RepoPermission } from "../../outbound/repo-access-ports.js";

function person(repos: string[], tokenHash = "ana-hash"): Asker {
  return { tokenHash, user: { login: "ana", repos } };
}

const SERVICE: Asker = { user: null, tokenHash: null };

function access(answer: RepoPermission | Error = "none") {
  let clock = 1_000;
  const permissionOf = vi.fn(async () => {
    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });
  const remember = vi.fn(async () => {});

  return {
    permissionOf,
    remember,
    later: (ms: number) => (clock += ms),
    ...createRepoAccess({ permissionOf, remember, now: () => clock }),
  };
}

describe("repo access", () => {
  it("lets a service token open any repo without asking GitHub", async () => {
    const lore = access();

    expect({
      open: await lore.canOpen(SERVICE, "other/secret"),
      asked: lore.permissionOf.mock.calls.length,
    }).toEqual({ open: true, asked: 0 });
  });

  it("lets a person open a repo of their sign-in list, in any letter case, without asking GitHub", async () => {
    const lore = access();

    expect({
      open: await lore.canOpen(person(["Acme/App"]), "acme/app"),
      asked: lore.permissionOf.mock.calls.length,
    }).toEqual({ open: true, asked: 0 });
  });

  it.each(["read", "write", "admin"] as const)(
    "refuses a read outside the sign-in list even when GitHub says %s, without asking GitHub",
    async (permission) => {
      const lore = access(permission);

      expect({
        open: await lore.canOpen(person([]), "acme/new-repo"),
        asked: lore.permissionOf.mock.calls.length,
        remembered: lore.remember.mock.calls.length,
      }).toEqual({ open: false, asked: 0, remembered: 0 });
    },
  );

  it("refuses when GitHub cannot be asked, never granting on an error", async () => {
    const lore = access(new Error("GitHub is down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await lore.canOpen(person([]), "acme/app")).toBe(false);
    warn.mockRestore();
  });

  it("answers from the sign-in list alone when a server has no GitHub to ask", async () => {
    expect({
      listed: await SIGN_IN_LIST_ONLY.canOpen(person(["acme/app"]), "acme/app"),
      unlisted: await SIGN_IN_LIST_ONLY.canOpen(person([]), "acme/app"),
      listedWrite: await SIGN_IN_LIST_ONLY.canOpen(
        person(["acme/app"]),
        "acme/app",
        "write",
      ),
      serviceAdmin: await SIGN_IN_LIST_ONLY.canOpen(
        SERVICE,
        "acme/app",
        "admin",
      ),
    }).toEqual({
      listed: true,
      unlisted: false,
      listedWrite: false,
      serviceAdmin: true,
    });
  });

  it("asks GitHub on write and admin even for a repo in the sign-in list, refusing when GitHub reports a lower level", async () => {
    const readGrant = access("read");
    const writeGrant = access("write");
    const adminGrant = access("admin");
    const listed = person(["acme/app"]);

    expect({
      readOnWrite: await readGrant.canOpen(listed, "acme/app", "write"),
      writeOnWrite: await writeGrant.canOpen(listed, "acme/app", "write"),
      writeOnAdmin: await writeGrant.canOpen(listed, "acme/app", "admin"),
      adminOnAdmin: await adminGrant.canOpen(listed, "acme/app", "admin"),
      askedOnListedWrite: readGrant.permissionOf.mock.calls,
    }).toEqual({
      readOnWrite: false,
      writeOnWrite: true,
      writeOnAdmin: false,
      adminOnAdmin: true,
      askedOnListedWrite: [["ana", "acme/app", "ana-hash"]],
    });
  });

  it("refuses write and admin on acme/new-repo, outside the sign-in list, though GitHub reports admin", async () => {
    const lore = access("admin");
    const unlisted = person([]);

    expect({
      write: await lore.canOpen(unlisted, "acme/new-repo", "write"),
      admin: await lore.canOpen(unlisted, "acme/new-repo", "admin"),
    }).toEqual({ write: false, admin: false });
  });

  it("lets a service token pass write and admin checks without asking GitHub", async () => {
    const lore = access("none");

    expect({
      write: await lore.canOpen(SERVICE, "other/secret", "write"),
      admin: await lore.canOpen(SERVICE, "other/secret", "admin"),
      asked: lore.permissionOf.mock.calls,
    }).toEqual({ write: true, admin: true, asked: [] });
  });

  it("refuses write and admin when GitHub cannot be asked, even for a repo in the sign-in list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lore = access(new Error("GitHub is down"));
    const listed = person(["acme/app"]);

    expect({
      write: await lore.canOpen(listed, "acme/app", "write"),
      admin: await lore.canOpen(listed, "acme/app", "admin"),
    }).toEqual({ write: false, admin: false });
    warn.mockRestore();
  });

  it("rethrows PersonTokenUnavailable on write and admin instead of turning it into a refusal", async () => {
    const { PersonTokenUnavailable } =
      await import("../../outbound/repo-access-ports.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unavailable = new PersonTokenUnavailable("refresh refused");
    const lore = access(unavailable);
    const listed = person(["acme/app"]);

    await expect(lore.canOpen(listed, "acme/app", "write")).rejects.toEqual(
      unavailable,
    );
    await expect(lore.canOpen(listed, "acme/app", "admin")).rejects.toEqual(
      unavailable,
    );
    expect(warn.mock.calls).toEqual([]);
    warn.mockRestore();
  });
});
