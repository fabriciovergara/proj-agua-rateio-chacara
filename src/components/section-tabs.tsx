import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

/**
 * Sub-navigation between sibling pages (Chácaras / Proprietários…), drawn
 * like shadcn's line tabs but made of real links.
 */
export function SectionTabs({
  label,
  items,
}: {
  label: string
  items: ReadonlyArray<{ to: ComponentProps<typeof Link>['to']; label: string }>
}) {
  return (
    <nav aria-label={label} className="mb-8 border-b">
      <ul className="flex gap-2">
        {items.map((item) => (
          <li key={String(item.to)}>
            <Link
              to={item.to}
              className="-mb-px flex h-11 items-center border-b-2 border-transparent px-4 font-semibold text-muted-foreground transition-colors hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
