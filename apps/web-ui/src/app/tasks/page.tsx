export const dynamic = "force-dynamic";

import { query, queryAllChunks } from "@/lib/db";
import { revalidatePath } from "next/cache";
import TasksView from "./TasksView";

interface Task {
  id: string;
  content: string;
  content_type: string;
  metadata: Record<string, string>;
  ingested_at: string;
}

interface AuditEntry {
  agent_id: string;
  operation: string;
  memory_key: string;
  metadata: Record<string, string>;
  created_at: string;
}

async function createTask(formData: FormData) {
  "use server";
  const description = formData.get("description") as string;

  if (!description) {
    return;
  }
  await query(
    `INSERT INTO org_shared.chunks (content, content_type, team, repo, file_path, metadata)
     VALUES ($1, 'task', 'org', 're-cinq/lore', 'tasks/ui-created', $2)`,
    [description, JSON.stringify({ created_by: "ui", status: "open" })],
  );
  revalidatePath("/tasks");
}

export default async function TasksPage() {
  const tasks = await queryAllChunks<Task>(
    (schema) => ({
      sql: `SELECT id, content, content_type, metadata, ingested_at
            FROM ${schema}.chunks
            WHERE content_type = 'task'`,
      params: [],
    }),
    [],
    { orderBy: "ingested_at DESC, id DESC", limit: 50 },
  );

  const recentActivity = await query<AuditEntry>(`
    SELECT agent_id, operation, memory_key, metadata, created_at
    FROM memory.audit_log
    ORDER BY created_at DESC
    LIMIT 15
  `);

  return (
    <TasksView
      tasks={tasks}
      recentActivity={recentActivity}
      createTask={createTask}
    />
  );
}
