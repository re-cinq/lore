import { describe, expect, it } from "vitest";
import type {
  DgraphClientPort,
  DgraphTxn,
} from "../../outbound/memory-store.js";
import { anchorHashOf } from "../../domain/anchor-hash.js";
import { projectDocumentBlocks } from "./project-blocks.js";
import { projectSpecFile } from "./project-spec-file.js";
import {
  isUnchanged,
  storedChildrenOf,
  type ChildState,
  type PlannedChild,
} from "./unchanged-children.js";

const REPO = "re-cinq/lore";
const PATH = "specs/widget/spec.md";
const TEST_LINE = 'it("renders messages", () => {});';
const HASH = anchorHashOf(TEST_LINE);
const SPEC = `# Widget

## Requirements

- The widget MUST render messages. ([validated by renders messages @${HASH}](src/widget.test.ts#L1))
- The widget MUST accept a colour prop.
- The widget MUST log every click.

## Acceptance Criteria

- Messages render in order.
- The colour prop changes the border.
`;
const STORED: ChildState = {
  textHash: "h1",
  kind: "list_item",
  testability: "testable",
  category: "behaviour",
  sectionUid: "0x1",
  validated: ["re-cinq/lore|src/widget.test.ts"],
  implemented: [],
  decided: ["0x9"],
};
const PLANNED: PlannedChild = { ...STORED, linksInSync: true };

describe("isUnchanged", () => {
  it("skips a statement the graph holds exactly as this run would write it", () => {
    expect(isUnchanged(STORED, PLANNED)).toBe(true);
  });

  it.each([
    { shape: "a new text", planned: { textHash: "h2" } },
    { shape: "another kind", planned: { kind: "paragraph" } },
    { shape: "another testability", planned: { testability: "untestable" } },
    { shape: "another category", planned: { category: "background" } },
    { shape: "another section", planned: { sectionUid: "0x2" } },
    {
      shape: "a test link more",
      planned: {
        validated: [...STORED.validated, "re-cinq/lore|src/other.test.ts"],
      },
    },
    {
      shape: "a code link",
      planned: { implemented: ["re-cinq/lore|src/widget.ts|abcd1234"] },
    },
    { shape: "another cited ADR", planned: { decided: ["0x8"] } },
    {
      shape: "a hashed link whose test moved",
      planned: { linksInSync: false },
    },
  ])("writes a statement planned with $shape", ({ planned }) => {
    expect(isUnchanged(STORED, { ...PLANNED, ...planned })).toBe(false);
  });

  it("writes a statement the graph does not hold", () => {
    expect(isUnchanged(undefined, PLANNED)).toBe(false);
  });

  it("skips a statement whose stored category, section and ADR edge this run would not write", () => {
    const planned: PlannedChild = {
      textHash: "h1",
      kind: "list_item",
      testability: "testable",
      validated: STORED.validated,
      implemented: [],
      linksInSync: true,
    };

    expect(isUnchanged({ ...STORED, decided: ["0x7"] }, planned)).toBe(true);
  });

  it("writes a statement whose stored test link is missing, as after a projection that died before its edges", () => {
    expect(isUnchanged({ ...STORED, validated: [] }, PLANNED)).toBe(false);
  });

  it("compares links as sets, so a test file cited twice still matches its one edge", () => {
    expect(
      isUnchanged(STORED, {
        ...PLANNED,
        validated: [...STORED.validated, ...STORED.validated],
      }),
    ).toBe(true);
  });
});

describe("storedChildrenOf", () => {
  it("reads a statement's single section edge as an object and its test links by xid, and drops a row with no xid", () => {
    const stored = storedChildrenOf({
      statements: [
        {
          xid: `${REPO}|${PATH}|2`,
          textHash: "h1",
          kind: "list_item",
          testability: "testable",
          section: { uid: "0x1" },
          validated: [{ xid: `${REPO}|src/widget.test.ts` }],
          decided: [{ uid: "0x9" }],
        },
        { textHash: "orphan" },
      ],
      criteria: [{ xid: `${REPO}|${PATH}|ac|9`, textHash: "h3" }],
    });

    expect({
      statements: [...stored.statements],
      criteria: [...stored.criteria],
    }).toEqual({
      statements: [
        [
          `${REPO}|${PATH}|2`,
          {
            textHash: "h1",
            kind: "list_item",
            testability: "testable",
            sectionUid: "0x1",
            validated: [`${REPO}|src/widget.test.ts`],
            implemented: [],
            decided: ["0x9"],
          },
        ],
      ],
      criteria: [
        [
          `${REPO}|${PATH}|ac|9`,
          { textHash: "h3", validated: [], implemented: [], decided: [] },
        ],
      ],
    });
  });
});

describe("projectSpecFile skipping unchanged children (fake port)", () => {
  it("writes only the reworded statement and embeds only its text when one statement of three changes", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    const run = await project(
      graph,
      reword(SPEC, "log every click", "log every tap"),
    );

    expect(run).toMatchObject({
      statementWrites: 1,
      criterionWrites: 0,
      embedded: [["The widget MUST log every tap."]],
    });
  });

  it("writes only the reworded acceptance criterion when one of two changes", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    const run = await project(
      graph,
      reword(SPEC, "render in order", "render newest first"),
    );

    expect(run).toMatchObject({ statementWrites: 0, criterionWrites: 1 });
  });

  it("writes every statement and criterion again when forced, though nothing changed", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);

    expect(await project(graph, SPEC, { force: true })).toMatchObject({
      statementWrites: 3,
      criterionWrites: 2,
    });
  });

  it("writes the unchanged message statement again when its hashed test moved from line 1 to line 3, and moves the TestChunk with it", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    const run = await project(
      graph,
      reword(SPEC, "log every click", "log every tap"),
      {
        testFile: `\n\n${TEST_LINE}\n`,
      },
    );

    expect({
      statementWrites: run.statementWrites,
      line: graph.node("TestChunk", `${REPO}|src/widget.test.ts`)?.[
        "TestChunk.start_line"
      ],
    }).toEqual({ statementWrites: 2, line: 3 });
  });

  it("writes the unchanged message statement again when the graph lost its test link, as a projection that died mid-statement leaves it", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    graph.dropEdge("Statement", `${REPO}|${PATH}|0`, "Statement.validated_by");
    const run = await project(
      graph,
      reword(SPEC, "log every click", "log every tap"),
    );

    expect(run.statementWrites).toBe(2);
  });
});

describe("projectSpecFile skipping unchanged blocks (fake port)", () => {
  it("writes only the reworded statement's block when one statement of three changes", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    const run = await project(
      graph,
      reword(SPEC, "log every click", "log every tap"),
    );

    expect(run.blockWrites).toBe(1);
  });

  it("writes all 13 blocks again when forced, though nothing changed", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);

    expect((await project(graph, SPEC, { force: true })).blockWrites).toBe(13);
  });

  it("writes a blank block again when its empty text never reached the graph, as a projection that died between a block's two writes leaves it", async () => {
    const graph = fakeGraph();

    await project(graph, SPEC);
    graph.dropEdge("Block", `${REPO}|${PATH}|block|1`, "Block.text");
    const run = await project(
      graph,
      reword(SPEC, "log every click", "log every tap"),
    );

    expect(run.blockWrites).toBe(2);
  });

  it("writes a heading block again only when the graph holds another kind or level for its text", async () => {
    const writes = async (stored: Partial<{ kind: string; level: number }>) => {
      const graph = fakeGraph();
      const heading = { kind: "heading", text: "## Requirements", level: 2 };

      await projectDocumentBlocks(
        graph.port,
        { repo: REPO, filePath: PATH, content: "## Requirements\n" },
        undefined,
        new Map([
          [`${REPO}|${PATH}|block|0`, { ...heading, ...stored }],
          [`${REPO}|${PATH}|block|1`, { kind: "blank", text: "" }],
        ]),
      );

      return graph.queries.filter((query) => query.includes("eq(Block.xid"))
        .length;
    };

    expect([
      await writes({ level: 3 }),
      await writes({ kind: "paragraph" }),
      await writes({}),
    ]).toEqual([1, 1, 0]);
  });
});

function reword(spec: string, from: string, to: string): string {
  return spec.replace(from, to);
}

async function project(
  graph: FakeGraph,
  content: string,
  { force = false, testFile = `${TEST_LINE}\n` } = {},
) {
  const embedded: string[][] = [];
  const queriesBefore = graph.queries.length;

  await projectSpecFile({ repo: REPO, filePath: PATH, content }, graph.port, {
    force,
    embed: async (texts) => {
      embedded.push(texts);

      return texts.map(() => [0.1, 0.2]);
    },
    readLinked: async (path) =>
      path === "src/widget.test.ts" ? testFile : null,
  });
  const queries = graph.queries.slice(queriesBefore);

  return {
    statementWrites: queries.filter((query) =>
      query.includes("eq(Statement.xid"),
    ).length,
    criterionWrites: queries.filter((query) =>
      query.includes("eq(AcceptanceCriterion.xid"),
    ).length,
    embedded: embedded.filter((texts) => texts.length > 0),
    blockWrites: queries.filter((query) => query.includes("eq(Block.xid"))
      .length,
  };
}

type Row = Record<string, unknown>;

interface FakeGraph {
  port: DgraphClientPort;
  queries: string[];
  node(type: string, xid: string): Row | undefined;
  dropEdge(type: string, xid: string, predicate: string): void;
}

function fakeGraph(): FakeGraph {
  const nodes = new Map<string, Row>();
  const uidByXid = new Map<string, string>();
  const queries: string[] = [];
  const store = { nodes, uidByXid, next: 1 };
  const txn: DgraphTxn = {
    queryWithVars: async (query, vars) => {
      queries.push(query);

      return { data: answer(store, query, vars) };
    },
    mutate: async (request) => ({
      data: { uids: applyMutation(store, request) },
    }),
    discard: async () => {},
  };

  return {
    port: { newTxn: () => txn },
    queries,
    node: (type, xid) => nodes.get(uidByXid.get(`${type}|${xid}`) ?? ""),
    dropEdge: (type, xid, predicate) => {
      delete nodes.get(uidByXid.get(`${type}|${xid}`) ?? "")?.[predicate];
    },
  };
}

interface Store {
  nodes: Map<string, Row>;
  uidByXid: Map<string, string>;
  next: number;
}

function answer(
  store: Store,
  query: string,
  vars: Record<string, string>,
): Record<string, Row[] | undefined> {
  const uid = uidFor(store, query, vars);

  if (query.includes("statements: ~Statement.spec")) {
    return { spec: uid === undefined ? [] : [storedRows(store, uid)] };
  }

  return { found: foundRows(store, query, uid) };
}

function uidFor(
  store: Store,
  query: string,
  vars: Record<string, string>,
): string | undefined {
  const type = /eq\((\w+)\.xid/.exec(query)?.[1];

  return store.uidByXid.get(`${type}|${vars["$xid"]}`);
}

function foundRows(
  store: Store,
  query: string,
  uid: string | undefined,
): Row[] {
  if (uid === undefined || !query.includes("found(func: eq(")) {
    return [];
  }

  return [
    query.includes("content_hash") ? (store.nodes.get(uid) ?? {}) : { uid },
  ];
}

function storedRows(store: Store, specUid: string): Row {
  const children = (type: string) =>
    [...store.nodes.values()].filter(
      (node) => (node[`${type}.spec`] as Row | undefined)?.["uid"] === specUid,
    );
  const xids = (node: Row, predicate: string, type: string) =>
    ((node[predicate] as Row[] | undefined) ?? []).map(({ uid }) => ({
      xid: store.nodes.get(uid as string)?.[`${type}.xid`],
    }));

  return {
    statements: children("Statement").map((node) => ({
      xid: node["Statement.xid"],
      textHash: node["Statement.text_hash"],
      kind: node["Statement.kind"],
      testability: node["Statement.testability"],
      category: node["Statement.category"],
      section: node["Statement.section"],
      validated: xids(node, "Statement.validated_by", "TestChunk"),
      implemented: xids(node, "Statement.implemented_by", "CodeChunk"),
      decided: node["Statement.decided_by"],
    })),
    criteria: children("AcceptanceCriterion").map((node) => ({
      xid: node["AcceptanceCriterion.xid"],
      textHash: node["AcceptanceCriterion.text_hash"],
      validated: xids(node, "AcceptanceCriterion.validated_by", "TestChunk"),
      implemented: xids(
        node,
        "AcceptanceCriterion.implemented_by",
        "CodeChunk",
      ),
    })),
    blocks: children("Block").map((node) => ({
      xid: node["Block.xid"],
      kind: node["Block.kind"],
      text: node["Block.text"],
      level: node["Block.level"],
    })),
  };
}

function applyMutation(
  store: Store,
  {
    setJson,
    setNquads,
    deleteNquads,
  }: { setJson?: unknown; setNquads?: string; deleteNquads?: string },
): Record<string, string> {
  for (const line of (deleteNquads ?? "").split("\n").filter(Boolean)) {
    applyDelete(store, line);
  }

  for (const line of (setNquads ?? "").split("\n").filter(Boolean)) {
    applyEmptyString(store, line);
  }

  return setJson === undefined ? {} : applySet(store, setJson as Row);
}

function applyEmptyString(store: Store, line: string): void {
  const [, subject = "", predicate = ""] =
    /^<([^>]+)> <([^>]+)> "" \.$/.exec(line) ?? [];
  const node = store.nodes.get(subject);

  if (node !== undefined) {
    node[predicate] = "";
  }
}

function applyDelete(store: Store, line: string): void {
  const { subject, predicate, object } = deleteParts(line);
  const node = store.nodes.get(subject);

  if (predicate === "*") {
    store.nodes.delete(subject);

    return;
  }

  if (node !== undefined) {
    const name = predicate.slice(1, -1);

    node[name] = remainingEdges(node[name], object);
  }
}

function deleteParts(
  line: string,
): Record<"subject" | "predicate" | "object", string> {
  const parts = /^<([^>]+)> (\*|<[^>]+>) (\*|<[^>]+>) \.$/.exec(line) ?? [];

  return {
    subject: String(parts[1]),
    predicate: String(parts[2]),
    object: String(parts[3]),
  };
}

function remainingEdges(value: unknown, object: string): Row[] | undefined {
  if (object === "*") {
    return undefined;
  }

  return ((value as Row[] | undefined) ?? []).filter(
    ({ uid }) => `<${String(uid)}>` !== object,
  );
}

function applySet(
  store: Store,
  { uid, ...fields }: Row,
): Record<string, string> {
  const raw = String(uid);

  if (!raw.startsWith("_:")) {
    store.nodes.set(raw, merged(store.nodes.get(raw) ?? {}, fields));

    return {};
  }
  const created = `0x${store.next++}`;
  const [xidKey, xid] =
    Object.entries(fields).find(([key]) => key.endsWith(".xid")) ?? [];

  store.nodes.set(created, fields);

  if (xidKey !== undefined && typeof xid === "string") {
    store.uidByXid.set(`${xidKey.slice(0, -".xid".length)}|${xid}`, created);
  }

  return { [raw.slice(2)]: created };
}

function merged(node: Row, fields: Row): Row {
  const next = { ...node };

  for (const [key, value] of Object.entries(fields)) {
    const known = next[key];

    next[key] =
      Array.isArray(value) && Array.isArray(known)
        ? unionByUid(known as Row[], value as Row[])
        : value;
  }

  return next;
}

function unionByUid(known: Row[], added: Row[]): Row[] {
  const uids = new Set(known.map(({ uid }) => uid));

  return [...known, ...added.filter(({ uid }) => !uids.has(uid))];
}
