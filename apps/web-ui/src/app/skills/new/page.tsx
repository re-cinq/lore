import { createSkill } from "../actions";
import { SkillForm } from "../SkillForm";

export default function NewSkillPage() {
  return <SkillForm skill={null} action={createSkill} />;
}
