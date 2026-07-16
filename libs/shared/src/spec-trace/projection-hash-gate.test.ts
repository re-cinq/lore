import { enforceTrue } from "../lib/enforce.js";
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";
import type { DgraphClientPort, DgraphTxn } from "../memory-store.js";

/**
 * The content_hash freshness gate must be a COMPLETED-projection receipt, not
 * an attempted-projection marker (spec-traceability-graph). A projection that
 * dies mid-file (dgraph txn abort under contention) must leave the gate open
 * so the next attempt re-projects the whole file — hash written first left 10
 * prod specs permanently skipped with partial children (2026-07-16 outage).
 *
 * Runs against a fake 3-method DgraphClientPort (no container): it answers
 * upsert find-queries from recorded nodes, assigns uids to blank nodes, and
 * can fail the Nth mutation like a real abort would.
 */

const SPEC_CONTENT = `# Feature Specification: Hash Gate

| Field | Value |
|-------|-------|
| Status | Draft |

The gate must reopen after a failed projection.

## Requirements

- **FR1** The hash is written last.
`;

const ADR_CONTENT = `# ADR-999: Hash gate ordering

## Decision

Write the content hash after the children.
`;

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

interface FakeDgraph {
  port: DgraphClientPort;
  mutations: Array<Record<string, unknown>>;
  nodeByXid: (xid: string) => Record<string, unknown> | undefined;
  failMutation: (n: number | null) => void;
}

function fakeDgraph(): FakeDgraph {
  const mutations: Array<Record<string, unknown>> = [];
  const nodesByUid = new Map<string, Record<string, unknown>>();
  const uidByXid = new Map<string, string>();
  let nextUid = 1;
  let failAt: number | null = null;

  const xidOf = (fields: Record<string, unknown>): string | undefined =>
    Object.entries(fields).find(([key]) => key.endsWith(".xid"))?.[1] as
      string | undefined;

  const txn: DgraphTxn = {
    queryWithVars: async (query: string, vars?: Record<string, string>) => {
      const xid = vars?.["$xid"];
      const uid = xid === undefined ? undefined : uidByXid.get(xid);

      if (uid === undefined) {
        return { data: { found: [] } };
      }
      const node = nodesByUid.get(uid) ?? {};

      if (query.includes("content_hash")) {
        return { data: { found: [node] } };
      }

      return { data: { found: [{ uid }] } };
    },

    mutate: async (mutation: Record<string, unknown>) => {
      mutations.push(mutation);

      enforceTrue(
        !(failAt !== null && mutations.length >= failAt),
        Error,
        "Transaction has been aborted. Please retry",
      );
      const setJson = mutation["setJson"] as
        Record<string, unknown> | undefined;

      if (!setJson) {
        return { data: {} };
      }
      const rawUid = setJson["uid"] as string;

      if (rawUid.startsWith("_:")) {
        const label = rawUid.slice(2);
        const uid = `0x${nextUid++}`;
        const { uid: _blank, ...fields } = setJson;

        nodesByUid.set(uid, fields);
        const xid = xidOf(fields);

        if (xid !== undefined) {
          uidByXid.set(xid, uid);
        }

        return { data: { uids: { [label]: uid } } };
      }
      const { uid: _existing, ...fields } = setJson;

      nodesByUid.set(rawUid, { ...nodesByUid.get(rawUid), ...fields });

      return { data: {} };
    },

    discard: async () => {},
  };

  return {
    port: { newTxn: () => txn },
    mutations,
    nodeByXid: (xid: string) => {
      const uid = uidByXid.get(xid);

      return uid === undefined ? undefined : nodesByUid.get(uid);
    },
    failMutation: (n: number | null) => {
      failAt = n;
    },
  };
}

const stubEmbed = async (): Promise<number[]> => [0.1, 0.2, 0.3];

describe("projectSpecFile hash gate (fake port)", () => {
  const xid = "re-cinq/lore|specs/hash-gate/spec.md";

  it("a projection that dies mid-file leaves no content_hash and the retry re-projects", async () => {
    const fake = fakeDgraph();

    fake.failMutation(4);
    await expect(
      projectSpecFile(
        "re-cinq/lore",
        "specs/hash-gate/spec.md",
        SPEC_CONTENT,
        fake.port,
        stubEmbed,
      ),
    ).rejects.toThrow("Transaction has been aborted. Please retry");
    expect(fake.nodeByXid(xid)?.["Spec.content_hash"]).toBeUndefined();

    fake.failMutation(null);

    expect(
      await projectSpecFile(
        "re-cinq/lore",
        "specs/hash-gate/spec.md",
        SPEC_CONTENT,
        fake.port,
        stubEmbed,
      ),
    ).toEqual({ projected: true });
    expect(fake.nodeByXid(xid)?.["Spec.content_hash"]).toBe(
      sha256(SPEC_CONTENT),
    );
  });

  it("a successful projection writes Spec.content_hash in the final mutation", async () => {
    const fake = fakeDgraph();

    await projectSpecFile(
      "re-cinq/lore",
      "specs/hash-gate/spec.md",
      SPEC_CONTENT,
      fake.port,
      stubEmbed,
    );
    const withHash = fake.mutations.flatMap((mutation, index) => {
      const setJson = mutation["setJson"] as
        Record<string, unknown> | undefined;

      return setJson?.["Spec.content_hash"] === undefined ? [] : [index];
    });

    expect(withHash).toEqual([fake.mutations.length - 1]);
  });

  it("a re-run with the persisted hash skips the file; force re-projects it", async () => {
    const fake = fakeDgraph();

    await projectSpecFile(
      "re-cinq/lore",
      "specs/hash-gate/spec.md",
      SPEC_CONTENT,
      fake.port,
      stubEmbed,
    );

    expect(
      await projectSpecFile(
        "re-cinq/lore",
        "specs/hash-gate/spec.md",
        SPEC_CONTENT,
        fake.port,
        stubEmbed,
      ),
    ).toEqual({ projected: false });
    expect(
      await projectSpecFile(
        "re-cinq/lore",
        "specs/hash-gate/spec.md",
        SPEC_CONTENT,
        fake.port,
        stubEmbed,
        true,
      ),
    ).toEqual({ projected: true });
  });
});

describe("projectAdrFile hash gate (fake port)", () => {
  const xid = "re-cinq/lore|adrs/ADR-999-hash-gate.md";

  it("a projection that dies mid-file leaves no content_hash and the retry re-projects", async () => {
    const fake = fakeDgraph();

    fake.failMutation(4);
    await expect(
      projectAdrFile(
        "re-cinq/lore",
        "adrs/ADR-999-hash-gate.md",
        ADR_CONTENT,
        fake.port,
      ),
    ).rejects.toThrow("Transaction has been aborted. Please retry");
    expect(fake.nodeByXid(xid)?.["ADR.content_hash"]).toBeUndefined();

    fake.failMutation(null);

    expect(
      await projectAdrFile(
        "re-cinq/lore",
        "adrs/ADR-999-hash-gate.md",
        ADR_CONTENT,
        fake.port,
      ),
    ).toEqual({ projected: true });
    expect(fake.nodeByXid(xid)?.["ADR.content_hash"]).toBe(sha256(ADR_CONTENT));
  });

  it("a successful projection writes ADR.content_hash in the final mutation", async () => {
    const fake = fakeDgraph();

    await projectAdrFile(
      "re-cinq/lore",
      "adrs/ADR-999-hash-gate.md",
      ADR_CONTENT,
      fake.port,
    );
    const withHash = fake.mutations.flatMap((mutation, index) => {
      const setJson = mutation["setJson"] as
        Record<string, unknown> | undefined;

      return setJson?.["ADR.content_hash"] === undefined ? [] : [index];
    });

    expect(withHash).toEqual([fake.mutations.length - 1]);
  });

  it("a re-run with the persisted hash skips the file; force re-projects it", async () => {
    const fake = fakeDgraph();

    await projectAdrFile(
      "re-cinq/lore",
      "adrs/ADR-999-hash-gate.md",
      ADR_CONTENT,
      fake.port,
    );

    expect(
      await projectAdrFile(
        "re-cinq/lore",
        "adrs/ADR-999-hash-gate.md",
        ADR_CONTENT,
        fake.port,
      ),
    ).toEqual({ projected: false });
    expect(
      await projectAdrFile(
        "re-cinq/lore",
        "adrs/ADR-999-hash-gate.md",
        ADR_CONTENT,
        fake.port,
        undefined,
        true,
      ),
    ).toEqual({ projected: true });
  });
});
