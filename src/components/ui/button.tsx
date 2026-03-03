/* eslint-disable react-refresh/only-export-components */
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--mf-radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mf-ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--mf-accent)] text-[var(--primary-foreground)] hover:bg-[var(--mf-accent-strong)]',
        secondary: 'bg-[var(--mf-surface-muted)] text-[var(--mf-text)] hover:bg-[var(--mf-surface-hover)]',
        outline: 'border border-[var(--mf-border)] bg-[var(--mf-surface)] text-[var(--mf-muted-strong)] hover:bg-[var(--mf-surface-muted)]',
        ghost: 'text-[var(--mf-muted)] hover:bg-[var(--mf-surface-muted)] hover:text-[var(--mf-muted-strong)]',
        toolbar: 'border border-transparent bg-transparent text-[var(--mf-muted)] hover:bg-[var(--mf-surface-muted)] hover:text-[var(--mf-muted-strong)]',
        toolbarAccent:
          'border border-[var(--mf-accent-pale-border)] bg-[var(--mf-accent-pale)] text-[var(--mf-ring)] hover:bg-[var(--mf-accent-pale-hover)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        icon: 'h-8 w-8',
        iconCompact: 'h-6 w-6 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
