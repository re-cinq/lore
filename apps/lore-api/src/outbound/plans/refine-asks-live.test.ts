import { afterAll, describe, expect, it } from "vitest";
import { docName } from "@re-cinq/planning-document";
import {
  createAgentWriter,
  createCollabServer,
  createMemoryPlanStore,
  createPlanningService,
} from "@re-cinq/planning-sync";
import { askRefine } from "@re-cinq/planning-yjs";
import { liveRefineAsks } from "./refine-asks-live.js";

const REPO = "re-cinq/lore";
const service = createPlanningService(createMemoryPlanStore());
const collab = createCollabServer({
  service,
  authenticator: { authenticate: async () => null },
});
const writer = createAgentWriter({ service, collab });

afterAll(() => collab.closeConnections());

async function planAskedOnScope(): Promise<string> {
  const { meta } = await service.createPlan({
    repo: REPO,
    title: "Spec maintenance",
    type: "feature",
    createdBy: "gedaiu",
  });
  const connection = await collab.openDirectConnection(
    docName({ repo: REPO, planId: meta.id }),
  );

  await connection.transact((document) =>
    askRefine(document, { slot: "scope", askedBy: "Szabo Bogdan" }),
  );
  await connection.disconnect();

  return meta.id;
}

describe("liveRefineAsks", () => {
  it("reads the scope ask Szabo Bogdan made on the plan's live document", async () => {
    const planId = await planAskedOnScope();

    expect(
      await liveRefineAsks(collab, { id: planId, repo: REPO }),
    ).toMatchObject([
      { slot: "scope", status: "asked", askedBy: "Szabo Bogdan" },
    ]);
  });

  it("reads the scope ask as failed once the agent writer failed it", async () => {
    const planId = await planAskedOnScope();

    await writer.failRefine({ planId, slot: "scope", reason: "never started" });

    expect(
      await liveRefineAsks(collab, { id: planId, repo: REPO }),
    ).toMatchObject([
      { slot: "scope", status: "failed", reason: "never started" },
    ]);
  });
});
