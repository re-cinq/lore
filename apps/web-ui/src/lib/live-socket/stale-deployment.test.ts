import { describe, it, expect } from "vitest";
import { isStaleDeployment, reloadingWhenStale } from "./stale-deployment";

const STALE = new Error(
  'Server Action "4080f7f2" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
);

describe("isStaleDeployment", () => {
  it("is true for the error Next.js throws on an action the server no longer has", () => {
    expect(isStaleDeployment(STALE)).toBe(true);
  });

  it("is false for a forbidden refusal", () => {
    expect(isStaleDeployment(new Error("forbidden"))).toBe(false);
  });
});

describe("reloadingWhenStale", () => {
  it("reloads once for two calls to a gone action, and still throws each time", async () => {
    const reloads: string[] = [];
    const openSocket = reloadingWhenStale(
      async () => {
        throw STALE;
      },
      () => reloads.push("reload"),
    );

    const outcomes = await Promise.allSettled([openSocket(), openSocket()]);

    expect({
      reloads,
      statuses: outcomes.map((outcome) => outcome.status),
    }).toEqual({ reloads: ["reload"], statuses: ["rejected", "rejected"] });
  });

  it("passes token-1 through and reloads nothing when the action answers", async () => {
    const reloads: string[] = [];
    const openSocket = reloadingWhenStale(
      async () => "token-1",
      () => reloads.push("reload"),
    );

    expect({ token: await openSocket(), reloads }).toEqual({
      token: "token-1",
      reloads: [],
    });
  });
});
