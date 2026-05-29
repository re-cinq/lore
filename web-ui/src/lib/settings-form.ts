export function parseSettingsForm(formData: FormData) {
  const selectedRepos = formData.getAll('cross_repo_repos') as string[];
  const updates: Record<string, unknown> = {
    task_types: (formData.get('task_types') as string || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    auto_review: formData.get('auto_review') === 'yes',
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: (formData.get('slack_channel_id') as string || '').trim() || undefined,
    dispatch_label: (formData.get('dispatch_label') as string || '').trim() || undefined,
  };

  const trustLevel = formData.get('trust_level') as string;
  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  for (const k of Object.keys(updates)) {
    if (updates[k] === undefined) delete updates[k];
  }

  return updates;
}
