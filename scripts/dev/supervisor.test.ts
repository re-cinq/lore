import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitChunk, Supervisor } from "./supervisor.ts";
import type { ServiceSpec } from "./services.ts";

function shellService(
  name: string,
  command: string,
  kind: ServiceSpec["kind"] = "server",
): ServiceSpec {
  return {
    name,
    command,
    kind,
    role: "",
    where: "",
    color: "white",
    env: {},
    probe: { kind: "none" },
  };
}

function recordingSupervisor(specs: ServiceSpec[]) {
  const events: string[] = [];
  const supervisor = new Supervisor(
    specs,
    { PATH: process.env.PATH ?? "" },
    process.cwd(),
    {
      onStart: (service) => events.push(`start ${service}`),
      onLine: (service, text) => events.push(`line ${service} ${text}`),
      onExit: (service, code) => events.push(`exit ${service} ${code}`),
    },
  );

  return { events, supervisor };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("splitChunk", () => {
  it("holds back a trailing partial line", () => {
    assert.deepEqual(splitChunk("", "one\ntw"), {
      lines: ["one"],
      pending: "tw",
    });
  });

  it("completes a held-back line with the next chunk", () => {
    assert.deepEqual(splitChunk("tw", "o\n"), { lines: ["two"], pending: "" });
  });
});

describe("Supervisor", () => {
  it("reports the lines and exit code of a service that crashes", async () => {
    const { events, supervisor } = recordingSupervisor([
      shellService("crasher", "printf 'one\\ntwo\\n'; exit 3"),
    ]);

    supervisor.startAll();
    await until(() => events.includes("exit crasher 3"));
    assert.deepEqual(events, [
      "start crasher",
      "line crasher one",
      "line crasher two",
      "exit crasher 3",
    ]);
  });

  it("stops a long-running service with its children and reports no exit", async () => {
    const { events, supervisor } = recordingSupervisor([
      shellService("sleeper", "sleep 30 & echo up; wait"),
    ]);

    supervisor.startAll();
    await until(() => events.includes("line sleeper up"));
    await supervisor.stopAll();
    assert.deepEqual(events, ["start sleeper", "line sleeper up"]);
  });

  it("starts the service again on restart", async () => {
    const { events, supervisor } = recordingSupervisor([
      shellService("sleeper", "echo up; sleep 30"),
    ]);

    supervisor.startAll();
    await until(() => events.includes("line sleeper up"));
    await supervisor.restart("sleeper");
    await until(
      () => events.filter((event) => event === "line sleeper up").length === 2,
    );
    await supervisor.stopAll();
    assert.deepEqual(events, [
      "start sleeper",
      "line sleeper up",
      "start sleeper",
      "line sleeper up",
    ]);
  });
});
