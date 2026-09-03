import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.agent_conversations` — the CLI conversation a node resumes from, so an agent keeps context across a run's nodes; `objectKey` is null in flight (row written at dispatch), and `assemblyLineId` deliberately has no FK so a pruned run row never costs continuity. */

export const AgentConversationSchema = z.object({
  id: z.string(),
  keyKind: z.string(),
  keyValue: z.string(),
  nodeId: z.string(),
  conversationId: z.string(),
  objectKey: z.string().nullable(),
  bytes: z.number().nullable(),
  assemblyLineId: z.string().nullable(),
  iteration: z.number().nullable(),
  createdAt: z.date(),
});

export type AgentConversation = z.infer<typeof AgentConversationSchema>;

export const AGENT_CONVERSATION_COLUMNS = {
  id: "id",
  keyKind: "key_kind",
  keyValue: "key_value",
  nodeId: "node_id",
  conversationId: "conversation_id",
  objectKey: "object_key",
  bytes: "bytes",
  assemblyLineId: "assembly_line_id",
  iteration: "iteration",
  createdAt: "created_at",
} as const satisfies ColumnMap<AgentConversation>;

export const AGENT_CONVERSATION_TABLE = "pipeline.agent_conversations";
