import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiRefusal } from "../context-evals/lore-api.mjs";
import { patientApi } from "./patient-api.mjs";

const answering = (statuses) => {
  const asked = [];

  return {
    asked,
    get: async (path) => {
      asked.push(path);
      const status = statuses.shift();

      if (status !== 200) {
        throw new ApiRefusal(status, "boom");
      }

      return { ok: true };
    },
  };
};

const noPause = async () => {};

test("patientApi asks again after a 500 and returns the answer that follows", async () => {
  const api = answering([500, 200]);

  assert.deepEqual(await patientApi(api, noPause).get("/api/floor-runs"), {
    ok: true,
  });
});

test("patientApi gives up after three 500s with the last refusal", async () => {
  const api = answering([500, 500, 500]);

  await assert.rejects(
    patientApi(api, noPause).get("/api/floor-runs"),
    new ApiRefusal(500, "boom"),
  );
});

test("patientApi does not ask again after a 403", async () => {
  const api = answering([403, 200]);

  await assert.rejects(patientApi(api, noPause).get("/api/floor-runs"));
  assert.equal(api.asked.length, 1);
});
