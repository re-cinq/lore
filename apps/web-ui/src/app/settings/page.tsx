export const dynamic = "force-dynamic";
import { getTaskStats } from "@/lib/api/tasks";
import { getOrgSettings, putOrgSettings } from "@/lib/api/repos";
import { listGithubInstallations } from "@/lib/api/github-installations";
import { revalidatePath } from "next/cache";
import SettingsView, {
  type SettingsApprovalConfig,
  type SettingsViewProps,
} from "./SettingsView";

type SettingsViewData = Omit<
  SettingsViewProps,
  "saveSettings" | "saveApprovalConfig" | "regenerateToken"
>;

export default async function SettingsPage() {
  return (
    <SettingsView
      {...viewDataFrom(await loadSettingsPageData())}
      saveSettings={saveSettings}
      saveApprovalConfig={saveApprovalConfig}
      regenerateToken={regenerateToken}
    />
  );
}

/** The view's data props from what the page loaded. */
function viewDataFrom(
  loaded: Awaited<ReturnType<typeof loadSettingsPageData>>,
): SettingsViewData {
  return {
    apiUrl: loaded.settingsMap.api_url || "",
    ingestToken: loaded.settingsMap.ingest_token || "",
    repoCount: loaded.repoCount,
    totalTasks: loaded.taskStats.total,
    tasksToday: loaded.taskStats.today,
    approvalConfig: loaded.approvalConfig,
    repoLines: Object.keys(loaded.approvalConfig.repos).join("\n"),
    githubInstallations: loaded.githubInstallations,
    githubInstallUrl: null,
  };
}

/** Everything the settings page renders from, read in one place so the page itself is the wiring. */
async function loadSettingsPageData() {
  const [org, stats, github] = await Promise.all([
    getOrgSettings(),
    getTaskStats(),
    listGithubInstallations(),
  ]);
  const settingsMap = settingsMapFrom(org);

  return {
    settingsMap,
    repoCount: repoCountFrom(org),
    taskStats: taskStatsFrom(stats),
    approvalConfig: resolveApprovalConfig(settingsMap),
    githubInstallations: github.status === "ok" ? github.data : [],
  };
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

async function regenerateToken() {
  "use server";
  const crypto = await import("crypto");
  const newToken = crypto.randomBytes(32).toString("hex");

  await putOrgSettings([{ key: "ingest_token", value: newToken }]);
  revalidatePath("/settings");
}
