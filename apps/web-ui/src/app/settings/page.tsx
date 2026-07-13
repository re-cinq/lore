export const dynamic = "force-dynamic";
import { query, queryOne } from "@/lib/db";
import { revalidatePath } from "next/cache";
import SettingsView, { type SettingsApprovalConfig } from "./SettingsView";

async function saveSettings(formData: FormData) {
  "use server";
  const entries = [
    { key: "api_url", value: formData.get("api_url") as string },
    { key: "ingest_token", value: formData.get("ingest_token") as string },
  ];
  for (const { key, value } of entries) {
    if (value?.trim()) {
      await query(
        `INSERT INTO lore.settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
        [key, value.trim()],
      );
    }
  }
  revalidatePath("/settings");
}

async function saveApprovalConfig(formData: FormData) {
  "use server";
  const required = formData.get("approval_required") === "on";
  const label =
    (formData.get("approval_label") as string)?.trim() || "approved";
  const autoApproveRaw = (formData.get("auto_approve") as string) || "";
  const auto_approve = autoApproveRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const reposRaw = (formData.get("approval_repos") as string) || "";
  const repos: Record<string, { required: boolean }> = {};
  for (const line of reposRaw.split("\n")) {
    const repo = line.trim();
    if (repo) repos[repo] = { required: true };
  }
  const config = { required, label, auto_approve, repos };
  await query(
    `INSERT INTO lore.settings (key, value) VALUES ('approval_config', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(config)],
  );
  revalidatePath("/settings");
}

async function regenerateToken() {
  "use server";
  const crypto = await import("crypto");
  const newToken = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO lore.settings (key, value) VALUES ('ingest_token', $1)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [newToken],
  );
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const settings = await query<{
    key: string;
    value: string;
    updated_at: string;
  }>(`SELECT key, value, updated_at FROM lore.settings ORDER BY key`);
  const settingsMap: Record<string, string> = {};
  for (const s of settings) settingsMap[s.key] = s.value;

  const repoCount = await queryOne<{ count: number }>(
    `SELECT count(*)::int as count FROM lore.repos`,
  );

  const taskStats = await queryOne<{ total: number; today: number }>(
    `SELECT count(*)::int as total,
            count(*) FILTER (WHERE created_at > current_date)::int as today
     FROM pipeline.tasks`,
  );

  let approvalConfig: SettingsApprovalConfig = {
    required: false,
    label: "approved",
    auto_approve: ["general", "gap-fill"],
    repos: {},
  };
  try {
    if (settingsMap.approval_config)
      approvalConfig = {
        ...approvalConfig,
        ...JSON.parse(settingsMap.approval_config),
      };
  } catch {
    /* use defaults */
  }
  const repoLines = Object.keys(approvalConfig.repos).join("\n");

  return (
    <SettingsView
      apiUrl={settingsMap.api_url || ""}
      ingestToken={settingsMap.ingest_token || ""}
      repoCount={repoCount?.count ?? 0}
      totalTasks={taskStats?.total ?? 0}
      tasksToday={taskStats?.today ?? 0}
      approvalConfig={approvalConfig}
      repoLines={repoLines}
      saveSettings={saveSettings}
      saveApprovalConfig={saveApprovalConfig}
      regenerateToken={regenerateToken}
    />
  );
}
