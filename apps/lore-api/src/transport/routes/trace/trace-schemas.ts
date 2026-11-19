import { z } from "zod";

const TraceSectionSchema = z.object({
  uid: z.string(),
  heading: z.string(),
  ordinal: z.number(),
  level: z.number().optional(),
});

const TraceLinkRefSchema = z.object({
  kind: z.enum(["test", "code", "adr"]),
  label: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  detail: z.string().optional(),
});

const TraceStatementSchema = z.object({
  uid: z.string(),
  ordinal: z.number(),
  text: z.string(),
  kind: z.string().optional(),
  testability: z.string().optional(),
  state: z.enum(["tested", "untested", "narrative"]),
  sectionUid: z.string().optional(),
  links: z.array(TraceLinkRefSchema),
  drifted: z.boolean().optional(),
  violated: z.boolean().optional(),
});

const TraceCoverageSchema = z.object({
  testable: z.number(),
  covered: z.number(),
  untestable: z.number(),
  ratio: z.number(),
});

export const TraceDocumentSchema = z.object({
  filePath: z.string(),
  title: z.string(),
  description: z.string(),
  sections: z.array(TraceSectionSchema),
  statements: z.array(TraceStatementSchema),
  coverage: TraceCoverageSchema,
});

const AdrSummarySchema = z.object({
  filePath: z.string(),
  title: z.string(),
  description: z.string(),
  status: z
    .object({
      status: z.enum([
        "draft",
        "in-progress",
        "shipped",
        "rejected",
        "retired",
      ]),
      label: z.string(),
    })
    .nullable(),
});

const SpecSummarySchema = AdrSummarySchema.extend({
  coverage: TraceCoverageSchema,
});

const SpecGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum([
        "Feature",
        "Spec",
        "Section",
        "Statement",
        "AcceptanceCriterion",
        "TestChunk",
        "CodeChunk",
        "File",
        "ADR",
      ]),
      label: z.string(),
      path: z.string().optional(),
      line: z.number().optional(),
      endLine: z.number().optional(),
      detail: z.string().optional(),
    }),
  ),
  links: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      kind: z.enum([
        "in_feature",
        "in_spec",
        "in_section",
        "has_statement",
        "validated_by",
        "implemented_by",
        "covers",
        "decided_by",
      ]),
    }),
  ),
});

// Every projection served by `/trace/{kind}` (FR12/FR13: multiplexed routes declare a union that every real response satisfies).
export const TraceReadSchema = z.union([
  z.object({ specs: z.array(z.string()) }),
  z.object({ summaries: z.array(SpecSummarySchema) }),
  z.object({ adrs: z.array(z.string()) }),
  z.object({ summaries: z.array(AdrSummarySchema) }),
  TraceDocumentSchema,
  z.object({ source: z.string().nullable() }),
  SpecGraphSchema,
  z.object({
    sections: z.array(
      z.object({
        uid: z.string(),
        heading: z.string(),
        total: z.number(),
        tested: z.number(),
      }),
    ),
    statements: z.array(
      z.object({
        uid: z.string(),
        sectionUid: z.string(),
        tested: z.boolean(),
        text: z.string(),
      }),
    ),
  }),
  z.object({
    tests: z.array(
      z.object({
        testFile: z.string(),
        statement: z.string().optional(),
        origin: z.enum(["main", "overlay"]),
        ranges: z.array(z.tuple([z.number(), z.number()])),
      }),
    ),
  }),
  z.object({
    failures: z.array(
      z.object({
        stationRunId: z.string(),
        nodeId: z.string(),
        iteration: z.number(),
        failureClass: z.string(),
        failureDetail: z.string(),
        commit: z.string(),
        occurredAt: z.string(),
        resolvedByCommit: z.string().optional(),
      }),
    ),
  }),
  z.object({
    callers: z.array(
      z.object({
        filePath: z.string(),
        symbol: z.string(),
        startLine: z.number(),
      }),
    ),
  }),
]);
