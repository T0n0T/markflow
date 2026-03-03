import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-[42px] w-full rounded-[var(--mf-radius-sm)] border border-[var(--mf-border-soft)] bg-[var(--mf-surface)] px-3 py-1 text-sm text-[var(--mf-text)] shadow-none outline-none transition-colors placeholder:text-[var(--mf-placeholder)] focus-visible:border-[var(--mf-ring)] focus-visible:ring-2 focus-visible:ring-[var(--mf-focus-ring-soft)] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
