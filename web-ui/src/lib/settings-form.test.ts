import { describe, it, expect } from 'vitest';
import { parseSettingsForm } from './settings-form';

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach(x => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

describe('parseSettingsForm', () => {
  it('auto_review is true when auto_review is "yes"', () => {
    expect(parseSettingsForm(form({ auto_review: 'yes' })).auto_review).toBe(true);
  });

  it('auto_review is false when auto_review is "no"', () => {
    expect(parseSettingsForm(form({ auto_review: 'no' })).auto_review).toBe(false);
  });

  it('task_types split into trimmed, non-empty values', () => {
    expect(parseSettingsForm(form({ task_types: 'general, gap-fill , ,review' })).task_types)
      .toEqual(['general', 'gap-fill', 'review']);
  });

  it('cross_repo enabled with the selected repos when any are chosen', () => {
    expect(parseSettingsForm(form({ cross_repo_repos: ['re-cinq/a', 're-cinq/b'] })))
      .toMatchObject({ cross_repo: true, cross_repo_repos: ['re-cinq/a', 're-cinq/b'] });
  });

  it('cross_repo disabled with empty repos when none chosen', () => {
    expect(parseSettingsForm(form({})))
      .toMatchObject({ cross_repo: false, cross_repo_repos: [] });
  });

  it('trust set with auto_promote_threshold when trust_level present', () => {
    expect(parseSettingsForm(form({ trust_level: 'full' })).trust)
      .toEqual({ level: 'full', auto_promote_threshold: 3 });
  });

  it('trust key absent when trust_level missing', () => {
    expect(parseSettingsForm(form({})).trust).toBeUndefined();
  });

  it('slack_channel_id and dispatch_label trimmed when present', () => {
    expect(parseSettingsForm(form({ slack_channel_id: ' C123 ', dispatch_label: ' lore ' })))
      .toMatchObject({ slack_channel_id: 'C123', dispatch_label: 'lore' });
  });

  it('omits slack_channel_id and dispatch_label keys when blank', () => {
    const result = parseSettingsForm(form({ slack_channel_id: '   ', dispatch_label: '' }));
    expect('slack_channel_id' in result).toBe(false);
    expect('dispatch_label' in result).toBe(false);
  });
});
