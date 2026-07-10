// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PoolValueCell } from './PoolValueCell';

const renderCell = (value: string) => {
  const { container } = render(
    <table>
      <tbody>
        <tr>
          <PoolValueCell value={value} />
        </tr>
      </tbody>
    </table>,
  );
  return within(container.querySelector('td')!);
};

describe('PoolValueCell', () => {
  it('shows the full value and only a Copy button when short', () => {
    const cell = renderCell('short value');
    expect(cell.getByText('short value')).toBeInTheDocument();
    expect(cell.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(cell.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('truncates a long value and toggles expand/collapse', () => {
    const long = 'x'.repeat(250);
    const cell = renderCell(long);
    expect(cell.getByText(`${'x'.repeat(200)}…`)).toBeInTheDocument();

    fireEvent.click(cell.getByRole('button', { name: 'Show more' }));
    expect(cell.getByText(long)).toBeInTheDocument();

    fireEvent.click(cell.getByRole('button', { name: 'Show less' }));
    expect(cell.getByText(`${'x'.repeat(200)}…`)).toBeInTheDocument();
  });
});
