import { fetchSkills } from "@/lib/fetch-skills";
import { skillCatalogueOf } from "@/lib/skill-options";
import AgentForm, { type AgentFormProps } from "./AgentForm";

/** The agent form with the org's skills catalogue loaded beside it; a failed load still renders the form, with an alert. */
export default async function AgentFormWithSkills(props: AgentFormProps) {
  const skills = skillCatalogueOf(await fetchSkills());

  return <AgentForm {...props} skills={skills} />;
}
