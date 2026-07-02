import { describe, it, expect } from "vitest";
import { getRequiredScope } from "./auth.js";

describe("getRequiredScope", () => {
  it("returns admin for the tokens route", () => {
    expect(getRequiredScope("/api/tokens")).toBe("admin");
  });

  // /api/onboard migrated to a native hapi route (Phase 9); its "admin" scope is
  // now enforced declaratively via bearerScope, not getRequiredScope.

  it("returns admin for the dark-factory settings route via override", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory")).toBe("admin");
  });

  it("returns admin for the dark-factory route with a query string", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory?x=1")).toBe("admin");
  });

  // ingest-graph migrated to a native hapi route (Phase 8); its "write" scope is
  // now enforced declaratively via bearerScope, not getRequiredScope.

  it("returns read for a GET on the agent-definitions route (runner resolve)", () => {
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "GET")).toBe("read");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions", "GET")).toBe("read");
  });

  it("returns admin for agent writes", () => {
    expect(getRequiredScope("/api/repos/o/r/agent-definitions", "POST")).toBe("admin");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "PUT")).toBe("admin");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "DELETE")).toBe("admin");
  });

  // The repo-webhook routes migrated to native hapi routes (Phase 10); their
  // read/write/admin scopes are now enforced declaratively via bearerScope.

  it("returns read for an unmapped route", () => {
    expect(getRequiredScope("/api/unknown/path")).toBe("read");
  });

  it("returns read for the repo-status route", () => {
    expect(getRequiredScope("/api/repo-status?repo=o/r")).toBe("read");
  });
});
