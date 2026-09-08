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

/** No org-default row under this name. Not a 404: the name may be a repo-scoped definition, or one that has not been created at org level yet, and both are reachable from the list this page links back to. */
function NotFound({ agentName }: { agentName: string }) {
  return (
    <div className="empty-state">
      <p>Agent definition &quot;{agentName}&quot; not found.</p>
    </div>
  );
}

/** Upserts the org-default row. Defined at module level rather than inside the page: it closes over nothing, and a server action that takes everything it needs from the form is one less thing serialized per render. */
async function saveAction(
  _prev: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  "use server";
  const { name: parsedName, def } = parseAgentForm(formData);

  if (!parsedName) {
    return { error: "name required" };
  }
  const result = await saveOrgAgent(def);

  if (result.status === "ok") {
    redirect("/agents");
  }

  return saveResultToState(result);
}

// Edits the ORG-DEFAULT definition (upserts the org row every repo without its own override inherits); no image field — the two-key image ceremony is repo-scoped.
export default async function EditOrgAgent({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const agentName = decodeURIComponent(name);
  const agents = await listOrgAgents();
  const agent = agents.find((a) => a.name === agentName) ?? null;

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
        <NotFound agentName={agentName} />
      )}
    </div>
  );
}
