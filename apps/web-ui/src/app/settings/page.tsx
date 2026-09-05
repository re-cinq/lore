export const dynamic = "force-dynamic";
import { getTaskStats } from "@/lib/api/tasks";
import { getOrgSettings, putOrgSettings } from "@/lib/api/repos";
import { revalidatePath } from "next/cache";
import SettingsView, { type SettingsApprovalConfig } from "./SettingsView";

async function saveSettings(formData: FormData) {
  "use server";
  const entries = [
    { key: "api_url", value: formData.get("api_url") as string | null },
    {
      key: "ingest_token",
      value: formData.get("ingest_token") as string | null,
    },
  ];

  await putOrgSettings(
    entries.map(({ key, value }) => ({ key, value: value ?? "" })),
  );
  revalidatePath("/settings");
}

function trimmedApprovalLabel(formData: FormData): string {
  return (
    (formData.get("approval_label") as string | null)?.trim() || "approved"
  );
}

function parseAutoApprove(formData: FormData): string[] {
  const raw = (formData.get("auto_approve") as string) || "";

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseApprovalRepos(
  formData: FormData,
): Record<string, { required: boolean }> {
  const raw = (formData.get("approval_repos") as string) || "";
  const repos: Record<string, { required: boolean }> = {};

  for (const line of raw.split("\n")) {
    const repo = line.trim();

    if (repo) {
      repos[repo] = { required: true };
    }
  }

  return repos;
}

async function saveApprovalConfig(formData: FormData) {
  "use server";
  const config = {
    required: formData.get("approval_required") === "on",
    label: trimmedApprovalLabel(formData),
    auto_approve: parseAutoApprove(formData),
    repos: parseApprovalRepos(formData),
  };

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

function settingsMapFrom(
  org: Awaited<ReturnType<typeof getOrgSettings>>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const entry of org.status === "ok" ? org.data.settings : []) {
    map[entry.key] = entry.value;
  }

  return map;
}

function repoCountFrom(org: Awaited<ReturnType<typeof getOrgSettings>>) {
  return org.status === "ok" ? org.data.repo_count : 0;
}

function taskStatsFrom(stats: Awaited<ReturnType<typeof getTaskStats>>) {
  return stats.status === "ok" ? stats.data : { total: 0, today: 0 };
}

const DEFAULT_APPROVAL_CONFIG: SettingsApprovalConfig = {
  required: false,
  label: "approved",
  auto_approve: ["general", "gap-fill"],
  repos: {},
};

function resolveApprovalConfig(
  settingsMap: Record<string, string>,
): SettingsApprovalConfig {
  if (!settingsMap.approval_config) {
    return DEFAULT_APPROVAL_CONFIG;
  }

  try {
    return {
      ...DEFAULT_APPROVAL_CONFIG,
      ...JSON.parse(settingsMap.approval_config),
    };
  } catch {
    return DEFAULT_APPROVAL_CONFIG;
  }
}

export default async function SettingsPage() {
  const org = await getOrgSettings();
  const settingsMap = settingsMapFrom(org);
  const stats = await getTaskStats();
  const taskStats = taskStatsFrom(stats);
  const approvalConfig = resolveApprovalConfig(settingsMap);
  const repoLines = Object.keys(approvalConfig.repos).join("\n");

  return (
    <SettingsView
      apiUrl={settingsMap.api_url || ""}
      ingestToken={settingsMap.ingest_token || ""}
      repoCount={repoCountFrom(org)}
      totalTasks={taskStats.total}
      tasksToday={taskStats.today}
      approvalConfig={approvalConfig}
      repoLines={repoLines}
      saveSettings={saveSettings}
      saveApprovalConfig={saveApprovalConfig}
      regenerateToken={regenerateToken}
    />
  );
}
