import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDeployment,
  classifyDockerContainer,
  classifyHttp,
  classifyMinikube,
} from "./health.ts";

describe("classifyHttp", () => {
  it("returns healthy for 200", () => {
    assert.deepEqual(classifyHttp(200, 0), { text: "healthy", tone: "ok" });
  });

  it("returns healthy for a 307 redirect", () => {
    assert.equal(classifyHttp(307, 0).text, "healthy");
  });

  it("returns down for 503", () => {
    assert.deepEqual(classifyHttp(503, 0), { text: "down", tone: "bad" });
  });

  it("returns starting when nothing answers after 5 seconds", () => {
    assert.deepEqual(classifyHttp(null, 5_000), {
      text: "starting",
      tone: "wait",
    });
  });

  it("returns down when nothing answers after 40 seconds", () => {
    assert.equal(classifyHttp(null, 40_000).text, "down");
  });
});

describe("classifyDockerContainer", () => {
  it("returns healthy for a healthy health status", () => {
    assert.equal(classifyDockerContainer("healthy\n").text, "healthy");
  });

  it("returns healthy for a running container without a healthcheck", () => {
    assert.equal(classifyDockerContainer("true\n").text, "healthy");
  });

  it("returns not found for empty output", () => {
    assert.deepEqual(classifyDockerContainer(""), {
      text: "not found",
      tone: "bad",
    });
  });
});

describe("classifyMinikube", () => {
  it("returns running for Running", () => {
    assert.deepEqual(classifyMinikube("Running\n", 0), {
      text: "running",
      tone: "ok",
    });
  });

  it("returns stopped for Stopped", () => {
    assert.equal(classifyMinikube("Stopped\n", 7).text, "stopped");
  });

  it("returns not installed when the binary is missing", () => {
    assert.deepEqual(classifyMinikube("", null), {
      text: "not installed",
      tone: "dim",
    });
  });
});

describe("classifyDeployment", () => {
  it("returns ok for 1/1", () => {
    assert.deepEqual(classifyDeployment("1/1"), { text: "1/1", tone: "ok" });
  });

  it("returns waiting for 0/1 with an empty ready count", () => {
    assert.deepEqual(classifyDeployment("/1"), { text: "0/1", tone: "wait" });
  });

  it("returns unknown for unparsable output", () => {
    assert.equal(classifyDeployment("Error from server").text, "unknown");
  });
});
