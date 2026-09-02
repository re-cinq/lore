export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listOrgAgents, saveOrgAgent } from "@/lib/agents-api";
import {
  parseAgentForm,
  saveResultToState,
  type AgentFormState,
} from "@/lib/agents-form";
import AgentForm from "../../../repos/[owner]/[repo]/agents/AgentForm";

/**
 * Edit an ORG-DEFAULT definition from the global /agents page. The save PUTs
 * `/api/agent-definitions/{name}`, which upserts the org row every repo
 * without its own override inherits — per-repo overrides still happen on a
 * repo's Agents tab. No image editing here: the two-key image ceremony is
 * repo-scoped, so the form hides the field (orgScope).
 */
export default async function EditOrgAgent({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const agentName = decodeURIComponent(name);
  const agents = await listOrgAgents();
  const agent = agents.find((a) => a.name === agentName) ?? null;

  async function saveAction(
    _prev: AgentFormState,
    formData: FormData,
  ): Promise<AgentFormState> {
    "use server";
    const { name: parsedName, def } = parseAgentForm(formData);

    if (!parsedName) {
      return { error: "name required" };
    }
    const r = await saveOrgAgent(def);

    if (r.status === "ok") {
      redirect("/agents");
    }

    return saveResultToState(r);
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/agents">Agents</Link> / <strong>{agentName}</strong>
      </div>
      <h1>Edit org-default definition: {agentName}</h1>
      {agent ? (
        <AgentForm
          repo=""
          agent={agent}
          action={saveAction}
          isNew={false}
          orgScope
        />
      ) : (
        <div className="empty-state">
          <p>Agent definition &quot;{agentName}&quot; not found.</p>
        </div>
      )}
    </div>
  );
}
