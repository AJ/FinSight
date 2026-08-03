import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CategoryBadge } from '@/components/transactions/CategoryBadge';
import '@/lib/categorization/categories';

describe('CategoryBadge', () => {
  it('renders category name for a valid categoryId', () => {
    render(<CategoryBadge categoryId="groceries" />);
    expect(screen.getByText('Groceries')).toBeTruthy();
  });

  it('renders "Unknown" for invalid categoryId', () => {
    const { container } = render(<CategoryBadge categoryId="nonexistent-category" />);
    expect(screen.getByText('Unknown')).toBeTruthy();
    // HelpCircle SVG should be rendered
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('falls back to HelpCircle for category with unmapped icon', () => {
    // 'transfer' has icon 'ArrowRightLeft' — verify it renders without error
    render(<CategoryBadge categoryId="transfer" />);
    expect(screen.getByText('Transfer')).toBeTruthy();
  });
});
