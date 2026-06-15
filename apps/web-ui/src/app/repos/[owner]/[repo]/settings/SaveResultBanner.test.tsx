// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SaveResultBanner, { INITIAL_SAVE_STATE } from './SaveResultBanner';

describe('SaveResultBanner', () => {
  it('renders nothing before a save', () => {
    const { container } = render(<SaveResultBanner state={INITIAL_SAVE_STATE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the saved confirmation when no privileged change occurred', () => {
    render(<SaveResultBanner state={{ saved: true, privileged: null }} />);
    expect(screen.getByText('Settings saved.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confirms applied privileged changes on ok', () => {
    render(<SaveResultBanner state={{ saved: true, privileged: { status: 'ok', applied: {}, ceremony: {} } }} />);
    expect(screen.getByText(/Privileged changes applied/)).toBeInTheDocument();
  });

  it('lists gated field paths and the approval-PR instructions on two_key_required', () => {
    render(<SaveResultBanner state={{
      saved: true,
      privileged: { status: 'two_key_required', fieldPaths: ['enabled', 'execution.image'], detail: '' },
    }} />);
    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(screen.getByText('execution.image')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/CODEOWNER/);
  });

  it('shows the code and detail on codeowners_failed', () => {
    render(<SaveResultBanner state={{
      saved: true,
      privileged: { status: 'codeowners_failed', code: 'approver_not_codeowner', detail: 'not allowed' },
    }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('approver_not_codeowner');
    expect(screen.getByRole('alert')).toHaveTextContent('not allowed');
  });

  it('warns when the gated API is unconfigured', () => {
    render(<SaveResultBanner state={{ saved: true, privileged: { status: 'unconfigured' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/not configured/);
  });

  it('shows the message on a generic error', () => {
    render(<SaveResultBanner state={{ saved: true, privileged: { status: 'error', message: 'boom' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
