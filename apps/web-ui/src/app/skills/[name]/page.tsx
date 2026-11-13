import { notFound } from "next/navigation";
import { Alert } from "@/components/Alert";
import { updateSkill } from "../actions";
import { fetchSkills } from "@/lib/fetch-skills";
import { SkillForm } from "../SkillForm";

export const dynamic = "force-dynamic";

export default async function EditSkillPage(props: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await props.params;
  const loaded = await fetchSkills();

  if (loaded.status === "failed") {
    return <Alert>Skills could not be loaded: {loaded.message}</Alert>;
  }

  const skill = loaded.skills.find((candidate) => candidate.name === name);

  if (!skill) {
    notFound();
  }

  return (
    <SkillForm skill={skill} action={updateSkill.bind(null, skill.name)} />
  );
}
