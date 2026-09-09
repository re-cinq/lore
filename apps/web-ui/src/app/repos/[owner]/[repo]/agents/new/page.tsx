export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAgent } from "@/lib/agents-api";
import {
  parseAgentForm,
  saveResultToState,
  type AgentFormState,
} from "@/lib/agents-form";
import { DEFAULT_EXECUTION_IMAGE } from "@/lib/dark-factory-resolve";
import AgentForm from "../AgentForm";

/** Creates the definition, redirecting to the list on success. The create write means a name that already exists is rejected by the API rather than silently overwriting the definition behind it. */
async function createDefinition(
  fullName: string,
  formData: FormData,
): Promise<AgentFormState> {
  const { name, def, approvalPr } = parseAgentForm(formData);

  if (!name) {
    return { error: "name required" };
  }
  const saved = await createAgent(fullName, def, approvalPr);

  if (saved.status === "ok") {
    redirect(`/repos/${fullName}/agents`);
  }

  return saveResultToState(saved);
}

function NewAgentHeader({ fullName }: { fullName: string }) {
  return (
    <>
      <div className="breadcrumb">
        <Link href={`/repos/${fullName}/agents`}>Agents</Link> /{" "}
        <strong>New agent definition</strong>
      </div>
      <h1>New agent definition</h1>
    </>
  );
}

interface NewAgentProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function NewAgent({ params }: NewAgentProps) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  async function createAction(_prev: AgentFormState, formData: FormData) {
    "use server";

    return await createDefinition(fullName, formData);
  }

  return (
    <div>
      <NewAgentHeader fullName={fullName} />
      <AgentForm
        repo={fullName}
        agent={null}
        action={createAction}
        isNew
        defaultImage={DEFAULT_EXECUTION_IMAGE}
      />
    </div>
  );
}
