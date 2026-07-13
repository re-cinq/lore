export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listAgents, saveAgent } from "@/lib/agents-api";
import {
  parseAgentForm,
  saveResultToState,
  type AgentFormState,
} from "@/lib/agents-form";
import { DEFAULT_EXECUTION_IMAGE } from "@/lib/dark-factory-resolve";
import AgentForm from "../../AgentForm";

export default async function EditAgent({
  params,
}: {
  params: Promise<{ owner: string; repo: string; name: string }>;
}) {
  const { owner, repo, name } = await params;
  const fullName = `${owner}/${repo}`;
  const agentName = decodeURIComponent(name);
  const agents = await listAgents(fullName);
  const agent = agents.find((a) => a.name === agentName) ?? null;

  async function saveAction(
    _prev: AgentFormState,
    formData: FormData,
  ): Promise<AgentFormState> {
    "use server";
    const { name: parsedName, def, approvalPr } = parseAgentForm(formData);
    if (!parsedName) return { error: "name required" };
    // isUpdate=true → upserts the repo's project row (forks an org definition on first edit).
    const r = await saveAgent(fullName, def, true, approvalPr);
    if (r.status === "ok") redirect(`/repos/${fullName}/agents`);
    return saveResultToState(r);
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href={`/repos/${fullName}/agents`}>Agents</Link> /{" "}
        <strong>{agentName}</strong>
      </div>
      <h1>Edit agent definition: {agentName}</h1>
      {agent ? (
        <AgentForm
          repo={fullName}
          agent={agent}
          action={saveAction}
          isNew={false}
          defaultImage={DEFAULT_EXECUTION_IMAGE}
        />
      ) : (
        <div className="empty-state">
          <p>Agent definition &quot;{agentName}&quot; not found.</p>
        </div>
      )}
    </div>
  );
}
