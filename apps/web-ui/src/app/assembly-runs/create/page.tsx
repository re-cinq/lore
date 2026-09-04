export const dynamic = "force-dynamic";
import { listAllRepos, reposOrThrow } from "@/lib/api/repos";
import AssemblyRunCreateView from "./AssemblyRunCreateView";
import { createTask } from "./create-task-action";

export default async function CreateTaskPage() {
  const repoList = reposOrThrow(await listAllRepos());
  const onboardedRepos = repoList.repos
    .map((repo) => ({ full_name: repo.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <AssemblyRunCreateView
      onboardedRepos={onboardedRepos}
      createTaskAction={createTask}
    />
  );
}
