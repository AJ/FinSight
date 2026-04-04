/**
 * Reusable react-select theme that matches the app's design system.
 * Import and pass to the `styles` prop of any react-select component.
 *
 * Usage:
 *   import { reactSelectTheme } from '@/components/ui/react-select-theme';
 *   <Select styles={reactSelectTheme} />
 */

import { StylesConfig } from 'react-select';

export const reactSelectTheme: StylesConfig<{ value: string; label: string }, false> = {
  control: (base, state) => ({
    ...base,
    backgroundColor: 'var(--card)',
    borderColor: state.isFocused ? 'var(--primary)' : 'var(--border)',
    boxShadow: state.isFocused ? '0 0 0 1px var(--primary)' : 'none',
    minHeight: '40px',
    '&:hover': {
      borderColor: 'var(--primary)',
    },
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--popover)',
    border: '1px solid var(--border)',
    minWidth: '100%',
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused
      ? 'var(--accent)'
      : state.isSelected
        ? 'var(--primary)'
        : 'var(--popover)',
    color: state.isSelected
      ? 'var(--primary-foreground)'
      : 'var(--popover-foreground)',
    padding: '8px 12px',
    '&:hover': {
      backgroundColor: 'var(--accent)',
    },
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--foreground)',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--muted-foreground)',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--foreground)',
  }),
  noOptionsMessage: (base) => ({
    ...base,
    color: 'var(--muted-foreground)',
    padding: '12px',
  }),
  loadingMessage: (base) => ({
    ...base,
    color: 'var(--muted-foreground)',
    padding: '12px',
  }),
  multiValue: (base) => ({
    ...base,
    backgroundColor: 'var(--accent)',
  }),
  multiValueLabel: (base) => ({
    ...base,
    color: 'var(--accent-foreground)',
  }),
  multiValueRemove: (base) => ({
    ...base,
    '&:hover': {
      backgroundColor: 'var(--destructive)',
      color: 'white',
    },
  }),
};
