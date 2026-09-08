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
import type { AgentDefinition } from "@/lib/agents-mirror";
import AgentForm, { type AgentFormAction } from "../../AgentForm";

function EditHeader({
  fullName,
  agentName,
}: {
  fullName: string;
  agentName: string;
}) {
  return (
    <>
      <div className="breadcrumb">
        <Link href={`/repos/${fullName}/agents`}>Agents</Link> /{" "}
        <strong>{agentName}</strong>
      </div>
      <h1>Edit agent definition: {agentName}</h1>
    </>
  );
}

/** The form, or the note that no such definition resolved. A name in the URL is not proof one exists — an org definition can be removed while a repo still links to it. */
function EditBody({
  fullName,
  agentName,
  agent,
  action,
}: {
  fullName: string;
  agentName: string;
  agent: AgentDefinition | null;
  action: AgentFormAction;
}) {
  if (!agent) {
    return (
      <div className="empty-state">
        <p>Agent definition &quot;{agentName}&quot; not found.</p>
      </div>
    );
  }

  return (
    <AgentForm
      repo={fullName}
      agent={agent}
      action={action}
      isNew={false}
      defaultImage={DEFAULT_EXECUTION_IMAGE}
    />
  );
}

/** Saves the edit, redirecting to the list on success. `isUpdate` is true, which upserts the repo's PROJECT row — an org definition forks into a repo-owned one on its first edit rather than being modified for everyone. */
async function saveEdit(
  fullName: string,
  formData: FormData,
): Promise<AgentFormState> {
  const { name: parsedName, def, approvalPr } = parseAgentForm(formData);

  if (!parsedName) {
    return { error: "name required" };
  }
  const saved = await saveAgent(fullName, def, true, approvalPr);

  if (saved.status === "ok") {
    redirect(`/repos/${fullName}/agents`);
  }

  return saveResultToState(saved);
}

export default async function EditAgent({
  params,
}: {
  params: Promise<{ owner: string; repo: string; name: string }>;
}) {
  const { owner, repo, name } = await params;
  const fullName = `${owner}/${repo}`;
  // The name is URL-encoded because a definition name may contain a slash.
  const agentName = decodeURIComponent(name);
  const agent =
    (await listAgents(fullName)).find((a) => a.name === agentName) ?? null;

  async function saveAction(
    _prev: AgentFormState,
    formData: FormData,
  ): Promise<AgentFormState> {
    "use server";

    return await saveEdit(fullName, formData);
  }

  return (
    <div>
      <EditHeader fullName={fullName} agentName={agentName} />
      <EditBody
        fullName={fullName}
        agentName={agentName}
        agent={agent}
        action={saveAction}
      />
    </div>
  );
}
