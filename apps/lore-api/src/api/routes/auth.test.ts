import { describe, it, expect } from "vitest";
import { getRequiredScope } from "./auth.js";

describe("getRequiredScope", () => {
  it("returns admin for the tokens route", () => {
    expect(getRequiredScope("/api/tokens")).toBe("admin");
  });

  it("returns admin for the onboard route", () => {
    expect(getRequiredScope("/api/onboard")).toBe("admin");
  });

  it("returns admin for the dark-factory settings route via override", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory")).toBe("admin");
  });

  it("returns admin for the dark-factory route with a query string", () => {
    expect(getRequiredScope("/api/repos/o/r/settings/dark-factory?x=1")).toBe("admin");
  });

  it("returns write for the ingest-graph route (no longer creates tasks for docs)", () => {
    expect(getRequiredScope("/api/repos/o/r/ingest-graph")).toBe("write");
  });

  it("returns read for a GET on the agent-definitions route (runner resolve)", () => {
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "GET")).toBe("read");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions", "GET")).toBe("read");
  });

  it("returns admin for agent writes", () => {
    expect(getRequiredScope("/api/repos/o/r/agent-definitions", "POST")).toBe("admin");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "PUT")).toBe("admin");
    expect(getRequiredScope("/api/repos/o/r/agent-definitions/general", "DELETE")).toBe("admin");
  });

  it("gates the webhook secret behind admin while status stays read", () => {
    expect(getRequiredScope("/api/repos/o/r/webhook/secret", "GET")).toBe("admin");
    expect(getRequiredScope("/api/repos/o/r/webhook", "GET")).toBe("read");
  });

  it("returns read for an unmapped route", () => {
    expect(getRequiredScope("/api/unknown/path")).toBe("read");
  });

  it("returns read for the repo-status route", () => {
    expect(getRequiredScope("/api/repo-status?repo=o/r")).toBe("read");
  });
});
