import { cn } from 'cn'
import { useId } from 'react'
import { Label } from '#/components/ui/label'
import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select'

/** A labelled select for the filter rows above lists, charts and reports. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string | number; label: string | number }>
  className?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      <NativeSelect
        id={id}
        className={cn('h-11 bg-background text-base md:text-base', className)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
