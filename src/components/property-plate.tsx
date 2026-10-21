import { cn } from 'cn'

/**
 * What goes on the plate: the chácara's number when its name has one
 * ("Chácara 29" → "29"), otherwise the initials ("Recanto Verde" → "RV").
 */
export function plateLabel(name: string): string {
  const number = name.match(/\d+/)?.[0]
  if (number) return number.slice(-4)
  const words = name
    .replace(/ch[áa]cara/gi, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 || /^[A-ZÀ-Ú]/.test(word))
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
  return initials || name.slice(0, 2).toUpperCase()
}

/** The enamel house-number plate that identifies a chácara. */
export function PropertyPlate({
  name,
  size,
  className,
}: {
  name: string
  size?: 'sm' | 'lg'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-size={size}
      className={cn('plate', className)}
    >
      {plateLabel(name)}
    </span>
  )
}
