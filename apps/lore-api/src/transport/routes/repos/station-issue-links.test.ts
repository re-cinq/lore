import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const calls: string[] = [];

vi.mock("../../../outbound/project-boot.js", () => ({
  projectFor: async (repo: string) => ({
    issues: {
      list: async (filter: { state?: string; labels?: string[] }) => {
        calls.push(`list:${repo}:${filter.state}:${filter.labels?.join("+")}`);

        return [];
      },
      addSubIssue: async (parent: number, child: number) => {
        calls.push(`sub:${repo}:${parent}:${child}`);
      },
      update: async (
        number: number,
        edit: { title?: string; body?: string },
      ) => {
        calls.push(`update:${repo}:${number}:${edit.title}:${edit.body}`);
      },
    },
  }),
}));

import { buildServer } from "../../../app/build-server.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const send = (method: "POST" | "PATCH", url: string, payload: object) =>
  buildServer(() => null).inject({ method, url, headers: AUTH, payload });

describe("station issue links", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    calls.length = 0;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("makes #2261 a sub-issue of #2260 in re-cinq/lore", async () => {
    const res = await send(
      "POST",
      "/api/repos/re-cinq/lore/issues/2260/sub-issues",
      { child: 2261 },
    );

    expect({ status: res.statusCode, calls }).toEqual({
      status: 200,
      calls: ["sub:re-cinq/lore:2260:2261"],
    });
  });

  it("rewrites #2260's title and body in re-cinq/lore", async () => {
    const res = await send("PATCH", "/api/repos/re-cinq/lore/issues/2260", {
      title: "User story: Issue triage",
      body: "- [ ] #2261 T001",
    });

    expect({ status: res.statusCode, calls }).toEqual({
      status: 200,
      calls: [
        "update:re-cinq/lore:2260:User story: Issue triage:- [ ] #2261 T001",
      ],
    });
  });

  it("lists re-cinq/lore's closed issues labelled lore-managed", async () => {
    const res = await buildServer(() => null).inject({
      method: "GET",
      url: "/api/repos/re-cinq/lore/issues?state=closed&labels=lore-managed",
      headers: AUTH,
    });

    expect({ status: res.statusCode, calls }).toEqual({
      status: 200,
      calls: ["list:re-cinq/lore:closed:lore-managed"],
    });
  });

  it("answers 400 for a sub-issue link with no child", async () => {
    const res = await send(
      "POST",
      "/api/repos/re-cinq/lore/issues/2260/sub-issues",
      {},
    );

    expect({ status: res.statusCode, calls }).toEqual({
      status: 400,
      calls: [],
    });
  });
});
