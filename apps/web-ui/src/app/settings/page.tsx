export const dynamic = "force-dynamic";
import { getTaskStats } from "@/lib/api/tasks";
import { getOrgSettings, putOrgSettings } from "@/lib/api/repos";
import { revalidatePath } from "next/cache";
import SettingsView, { type SettingsApprovalConfig } from "./SettingsView";

async function saveSettings(formData: FormData) {
  "use server";
  const entries = [
    { key: "api_url", value: formData.get("api_url") as string },
    { key: "ingest_token", value: formData.get("ingest_token") as string },
  ];

  await putOrgSettings(
    entries.map(({ key, value }) => ({ key, value: value ?? "" })),
  );
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

    if (repo) {
      repos[repo] = { required: true };
    }
  }
  const config = { required, label, auto_approve, repos };

  await putOrgSettings([
    { key: "approval_config", value: JSON.stringify(config) },
  ]);
  revalidatePath("/settings");
}

async function regenerateToken() {
  "use server";
  const crypto = await import("crypto");
  const newToken = crypto.randomBytes(32).toString("hex");

  await putOrgSettings([{ key: "ingest_token", value: newToken }]);
  revalidatePath("/settings");
}

export default async function SettingsPage() {
  const org = await getOrgSettings();
  const settingsMap: Record<string, string> = {};

  for (const entry of org.status === "ok" ? org.data.settings : []) {
    settingsMap[entry.key] = entry.value;
  }
  const repoCount = { count: org.status === "ok" ? org.data.repo_count : 0 };

  const stats = await getTaskStats();
  const taskStats = stats.status === "ok" ? stats.data : null;

  let approvalConfig: SettingsApprovalConfig = {
    required: false,
    label: "approved",
    auto_approve: ["general", "gap-fill"],
    repos: {},
  };

  try {
    if (settingsMap.approval_config) {
      approvalConfig = {
        ...approvalConfig,
        ...JSON.parse(settingsMap.approval_config),
      };
    }
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
